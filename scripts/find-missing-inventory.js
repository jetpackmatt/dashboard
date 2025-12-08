#!/usr/bin/env node
/**
 * Find transactions for inventory ID 20114295
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const missingInventoryId = '20114295'

  console.log('='.repeat(70))
  console.log(`SEARCHING FOR INVENTORY ID: ${missingInventoryId}`)
  console.log('='.repeat(70))

  // Search in additional_details for this inventory ID
  const { data: byDetails, error: error1 } = await supabase
    .from('transactions')
    .select('*')
    .contains('additional_details', { InventoryId: missingInventoryId })
    .limit(50)

  console.log('\n--- SEARCH BY additional_details.InventoryId ---')
  if (error1) {
    console.log('Error:', error1.message)
  } else {
    console.log('Found:', byDetails?.length || 0)
    if (byDetails && byDetails.length > 0) {
      console.log('Sample:')
      for (const tx of byDetails.slice(0, 5)) {
        console.log(`  Invoice: ${tx.invoice_id_sb}, Client: ${tx.client_id}, Date: ${tx.charge_date}`)
      }
    }
  }

  // Search by reference_id containing the inventory ID
  const { data: byRef, error: error2 } = await supabase
    .from('transactions')
    .select('*')
    .like('reference_id', `%-${missingInventoryId}-%`)
    .limit(50)

  console.log('\n--- SEARCH BY reference_id pattern ---')
  if (error2) {
    console.log('Error:', error2.message)
  } else {
    console.log('Found:', byRef?.length || 0)
    if (byRef && byRef.length > 0) {
      console.log('Sample:')
      for (const tx of byRef.slice(0, 5)) {
        console.log(`  Invoice: ${tx.invoice_id_sb}, Client: ${tx.client_id}, Date: ${tx.charge_date}`)
      }
    }
  }

  // Check if this inventory is in a DIFFERENT invoice_id_sb (previous week?)
  console.log('\n--- CHECK ALL STORAGE FOR NOV 2025 ---')
  const { data: novStorage } = await supabase
    .from('transactions')
    .select('invoice_id_sb, client_id, charge_date, additional_details')
    .eq('transaction_fee', 'Warehousing Fee')
    .gte('charge_date', '2025-11-01')
    .lte('charge_date', '2025-11-30')
    .limit(2000)

  // Find any with this inventory ID
  const matching = (novStorage || []).filter(tx => {
    const invId = tx.additional_details?.InventoryId
    return invId === missingInventoryId
  })

  console.log('Found with inventory', missingInventoryId, ':', matching.length)
  if (matching.length > 0) {
    const byInvoice = {}
    for (const tx of matching) {
      const key = `${tx.invoice_id_sb} (client: ${tx.client_id?.substring(0, 8)})`
      byInvoice[key] = (byInvoice[key] || 0) + 1
    }
    console.log('By invoice:', byInvoice)
  }

  // Check if the reference shows this is at Ontario 6 (CA)
  console.log('\n--- CHECK FC LOCATION ---')
  console.log('Reference file shows inventory 20114295 is at Ontario 6 (CA)')
  console.log('Our DB has FC IDs: 19 (Twin Lakes WI), 156 (Ontario CA)')

  // Check for reference_id pattern 156-20114295-*
  const { data: ontarioTx } = await supabase
    .from('transactions')
    .select('*')
    .like('reference_id', `156-${missingInventoryId}-%`)
    .limit(50)

  console.log('Ontario CA transactions for this inventory:', ontarioTx?.length || 0)
  if (ontarioTx && ontarioTx.length > 0) {
    for (const tx of ontarioTx.slice(0, 5)) {
      console.log(`  Invoice: ${tx.invoice_id_sb}, Client: ${tx.client_id}, Date: ${tx.charge_date}`)
    }
  }
}

main().catch(console.error)
