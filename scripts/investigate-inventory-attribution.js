#!/usr/bin/env node
/**
 * Investigate why inventory 20114295 is attributed to Methyl-Life instead of Henson
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const INVENTORY_ID = '20114295'
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const METHYL_LIFE_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'

async function main() {
  console.log('='.repeat(70))
  console.log(`INVESTIGATING INVENTORY ${INVENTORY_ID} ATTRIBUTION`)
  console.log('='.repeat(70))

  // 1. Check billing_storage table for this inventory
  console.log('\n--- 1. BILLING_STORAGE TABLE ---')
  const { data: storageRecords } = await supabase
    .from('billing_storage')
    .select('*')
    .eq('inventory_id', INVENTORY_ID)
    .limit(10)

  if (storageRecords && storageRecords.length > 0) {
    console.log('Found in billing_storage:', storageRecords.length, 'records')
    for (const rec of storageRecords.slice(0, 3)) {
      console.log(`  Client: ${rec.client_id}`)
      console.log(`  Product: ${rec.product_name || rec.sku || 'N/A'}`)
      console.log(`  Created: ${rec.created_at}`)
    }
  } else {
    console.log('NOT FOUND in billing_storage')
  }

  // 2. Check the transactions table directly
  console.log('\n--- 2. TRANSACTIONS TABLE ---')
  const { data: txRecords } = await supabase
    .from('transactions')
    .select('id, client_id, reference_id, additional_details, charge_date')
    .contains('additional_details', { InventoryId: INVENTORY_ID })
    .limit(20)

  if (txRecords && txRecords.length > 0) {
    console.log('Found transactions:', txRecords.length)
    const byClient = {}
    for (const tx of txRecords) {
      byClient[tx.client_id] = (byClient[tx.client_id] || 0) + 1
    }
    console.log('By client_id:')
    for (const [clientId, count] of Object.entries(byClient)) {
      const clientName = clientId === HENSON_ID ? 'Henson' :
                        clientId === METHYL_LIFE_ID ? 'Methyl-Life' : clientId
      console.log(`  ${clientName}: ${count}`)
    }
    console.log('\nSample transaction:')
    console.log(JSON.stringify(txRecords[0], null, 2))
  }

  // 3. Check ShipBob API directly for this inventory
  console.log('\n--- 3. SHIPBOB API INVENTORY LOOKUP ---')
  try {
    const resp = await fetch(`https://api.shipbob.com/1.0/inventory/${INVENTORY_ID}`, {
      headers: {
        'Authorization': 'Bearer ' + process.env.SHIPBOB_API_TOKEN,
        'Content-Type': 'application/json'
      }
    })
    if (resp.ok) {
      const data = await resp.json()
      console.log('API Response:')
      console.log(`  Name: ${data.name}`)
      console.log(`  SKU: ${data.sku || 'N/A'}`)
      console.log(`  Product ID: ${data.product_id}`)
      console.log(`  Is Active: ${data.is_active}`)
      console.log(`  Full response:`, JSON.stringify(data, null, 2).substring(0, 500))
    } else {
      console.log('API Error:', resp.status, await resp.text())
    }
  } catch (err) {
    console.log('API Error:', err.message)
  }

  // 4. Check if there's a products table or inventory table
  console.log('\n--- 4. CHECK RELATED TABLES ---')

  // Check for products table
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .or(`inventory_id.eq.${INVENTORY_ID},shipbob_inventory_id.eq.${INVENTORY_ID}`)
    .limit(5)

  if (products && products.length > 0) {
    console.log('Found in products table:', products.length)
    console.log(JSON.stringify(products[0], null, 2))
  } else {
    console.log('Not found in products table (or table does not exist)')
  }

  // 5. Check transaction sync logic - how was client_id determined?
  console.log('\n--- 5. TRANSACTION ATTRIBUTION SOURCE ---')
  const { data: sampleTx } = await supabase
    .from('transactions')
    .select('*')
    .contains('additional_details', { InventoryId: INVENTORY_ID })
    .limit(1)
    .single()

  if (sampleTx) {
    console.log('Sample transaction details:')
    console.log(`  ID: ${sampleTx.id}`)
    console.log(`  Reference ID: ${sampleTx.reference_id}`)
    console.log(`  Reference Type: ${sampleTx.reference_type}`)
    console.log(`  Client ID: ${sampleTx.client_id}`)
    console.log(`  Merchant ID: ${sampleTx.merchant_id}`)
    console.log(`  Invoice ID: ${sampleTx.invoice_id_sb}`)
    console.log(`  Additional Details:`, JSON.stringify(sampleTx.additional_details, null, 2))

    // The reference_id format is: {FC_ID}-{InventoryId}-{LocationType}
    // Let's parse it
    const parts = sampleTx.reference_id.split('-')
    console.log('\n  Parsed reference_id:')
    console.log(`    FC ID: ${parts[0]}`)
    console.log(`    Inventory ID: ${parts[1]}`)
    console.log(`    Location Type: ${parts[2]}`)
  }

  // 6. Check what merchant_id is associated with this inventory
  console.log('\n--- 6. CHECK MERCHANT ASSOCIATION ---')
  if (sampleTx && sampleTx.merchant_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('id, company_name, merchant_id')
      .eq('merchant_id', sampleTx.merchant_id)
      .single()

    if (client) {
      console.log(`Merchant ${sampleTx.merchant_id} belongs to: ${client.company_name}`)
    }
  }

  // 7. Check ShipBob API transactions directly
  console.log('\n--- 7. SHIPBOB API TRANSACTION CHECK ---')
  try {
    const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SHIPBOB_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: '2025-11-01T00:00:00Z',
        to_date: '2025-12-01T00:00:00Z',
        page_size: 100
      })
    })

    const data = await resp.json()
    const matching = (data.items || []).filter(t =>
      t.additional_details?.InventoryId === INVENTORY_ID ||
      t.reference_id?.includes(INVENTORY_ID)
    )

    console.log('API transactions with this inventory:', matching.length)
    if (matching.length > 0) {
      console.log('Sample from API:')
      const sample = matching[0]
      console.log(`  Reference ID: ${sample.reference_id}`)
      console.log(`  Merchant ID: ${sample.merchant_id}`)
      console.log(`  Channel ID: ${sample.channel_id}`)
      console.log(`  Additional Details:`, JSON.stringify(sample.additional_details, null, 2))
    }
  } catch (err) {
    console.log('API Error:', err.message)
  }
}

main().catch(console.error)
