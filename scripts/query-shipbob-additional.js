#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function check() {
  const token = process.env.SHIPBOB_API_TOKEN
  const hensonMerchantId = '33041'  // From clients table

  // Get Henson's merchant_id
  const { data: henson } = await supabase
    .from('clients')
    .select('merchant_id')
    .eq('id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .single()

  console.log('Henson merchant_id:', henson?.merchant_id)

  // Query ShipBob for all transactions in the period with pagination
  let allTx = []
  let cursor = null

  do {
    const body = {
      start_date: '2025-12-15',
      end_date: '2025-12-21',
      transaction_types: ['Charge'],
      page_size: 1000
    }
    if (cursor) body.cursor = cursor

    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = await response.json()
    allTx = allTx.concat(data.items || [])
    cursor = data.next || null
    console.log('Fetched', data.items?.length, 'tx, cursor:', cursor ? 'yes' : 'no')
  } while (cursor)

  console.log('\nTotal transactions fetched:', allTx.length)

  // Filter to Per Pick Fee and similar for Additional Services
  const additionalFeeTypes = ['Per Pick Fee', 'B2B - Each Pick Fee', 'B2B - Case Pick Fee', 'B2B - Label Fee', 'Materials Handling Fee']
  const additional = allTx.filter(t => additionalFeeTypes.includes(t.transaction_fee) && t.reference_type === 'Shipment')
  console.log('Additional Services transactions:', additional.length)

  // Sum by merchant_id
  const byMerchant = {}
  for (const t of additional) {
    const mid = String(t.merchant_id || 'NULL')
    if (byMerchant[mid] === undefined) byMerchant[mid] = { count: 0, total: 0, byFee: {} }
    byMerchant[mid].count++
    byMerchant[mid].total += parseFloat(t.amount)

    if (byMerchant[mid].byFee[t.transaction_fee] === undefined) {
      byMerchant[mid].byFee[t.transaction_fee] = { count: 0, total: 0 }
    }
    byMerchant[mid].byFee[t.transaction_fee].count++
    byMerchant[mid].byFee[t.transaction_fee].total += parseFloat(t.amount)
  }

  console.log('\nBy merchant_id:')
  for (const [mid, data] of Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total)) {
    const label = mid === henson?.merchant_id ? 'HENSON (' + mid + ')' : mid
    console.log(' ', label, ':', data.count, 'tx, $' + data.total.toFixed(2))
    for (const [ft, ftData] of Object.entries(data.byFee)) {
      console.log('     ', ft, ':', ftData.count, 'tx, $' + ftData.total.toFixed(2))
    }
  }
}

check().catch(console.error)
