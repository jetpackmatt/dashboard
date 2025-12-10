require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const eliClientId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'
const eliMerchantId = '402133'

async function main() {
  console.log('=== Syncing Eli Health WROs ===\n')

  // Get Eli Health's token
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
    .eq('id', eliClientId)
    .single()

  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token

  if (!token) {
    console.log('No token found for Eli Health')
    return
  }

  console.log('Fetching receiving orders from ShipBob API...')

  // Fetch receiving orders
  const res = await fetch('https://api.shipbob.com/2025-07/receiving?page_size=100', {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) {
    console.log('API error:', res.status, res.statusText)
    const text = await res.text()
    console.log('Response:', text)
    return
  }

  const data = await res.json()
  console.log('Found', data.length, 'receiving orders\n')

  // Check for our missing WROs
  const targetWros = [871098, 868192]
  let upserted = 0

  for (const wro of data) {
    const wroId = wro.id

    if (targetWros.includes(wroId)) {
      console.log('✅ Found target WRO:', wroId)
    }

    // Upsert to database
    const record = {
      client_id: eliClientId,
      merchant_id: eliMerchantId,
      shipbob_receiving_id: wroId,
      purchase_order_number: wro.purchase_order_number || null,
      status: wro.status || null,
      package_type: wro.package_type || null,
      box_packaging_type: wro.box_packaging_type || null,
      fc_id: wro.fulfillment_center?.id || null,
      fc_name: wro.fulfillment_center?.name || null,
      fc_timezone: wro.fulfillment_center?.timezone || null,
      expected_arrival_date: wro.expected_arrival_date || null,
      insert_date: wro.insert_date || null,
      last_updated_date: wro.last_updated_date || null,
      status_history: wro.status_history || null,
      inventory_quantities: wro.inventory_quantities || null,
      box_labels_uri: wro.box_labels_uri || null,
      synced_at: new Date().toISOString()
    }

    const { error } = await supabase
      .from('receiving_orders')
      .upsert(record, { onConflict: 'shipbob_receiving_id' })

    if (error) {
      console.log('Error upserting WRO', wroId, ':', error.message)
    } else {
      upserted++
    }
  }

  console.log('\nUpserted', upserted, 'receiving orders')

  // Now fix the WRO transactions
  console.log('\n=== Fixing WRO Transactions ===\n')

  // Re-run the WRO attribution fix
  const { data: wros } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id')

  const wroLookup = {}
  for (const wro of wros || []) {
    wroLookup[String(wro.shipbob_receiving_id)] = {
      client_id: wro.client_id,
      merchant_id: wro.merchant_id
    }
  }

  const { data: unattributedWros } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id')
    .is('merchant_id', null)
    .eq('reference_type', 'WRO')

  for (const tx of unattributedWros || []) {
    const wroInfo = wroLookup[tx.reference_id]
    if (wroInfo) {
      await supabase
        .from('transactions')
        .update({
          client_id: wroInfo.client_id,
          merchant_id: wroInfo.merchant_id
        })
        .eq('transaction_id', tx.transaction_id)

      console.log('✅ Fixed WRO tx:', tx.transaction_id, '-> client', wroInfo.client_id)
    }
  }

  // Recheck unattributed count
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('merchant_id', null)

  console.log('\nRemaining unattributed transactions:', count)
}

main().catch(console.error)
