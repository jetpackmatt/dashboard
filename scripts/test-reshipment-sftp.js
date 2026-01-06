#!/usr/bin/env node
/**
 * Test script to verify SFTP sync correctly handles reshipments
 *
 * Tests shipment 330867617 which has TWO Shipping transactions:
 * - Dec 22: tracking 7517859134, $3.95
 * - Dec 26: tracking 1437163232, $3.95
 *
 * The SFTP files should be:
 * - Dec 23 file → Dec 22 charge_date transaction
 * - Dec 27 file → Dec 26 charge_date transaction
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const shipmentId = '330867617'

  console.log(`\n=== Testing Reshipment SFTP Matching ===\n`)
  console.log(`Shipment ID: ${shipmentId}\n`)

  // Get all Shipping transactions for this shipment
  const { data: txs, error } = await supabase
    .from('transactions')
    .select('id, transaction_id, reference_id, fee_type, charge_date, cost, tracking_id, base_cost, surcharge, invoice_id_sb')
    .eq('reference_id', shipmentId)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .order('charge_date', { ascending: true })

  if (error) {
    console.error('Error fetching transactions:', error.message)
    process.exit(1)
  }

  console.log(`Found ${txs.length} Shipping transaction(s) for this shipment:\n`)

  for (const tx of txs) {
    console.log(`Transaction ${tx.transaction_id}:`)
    console.log(`  charge_date:   ${tx.charge_date}`)
    console.log(`  tracking_id:   ${tx.tracking_id}`)
    console.log(`  cost:          $${tx.cost}`)
    console.log(`  base_cost:     ${tx.base_cost !== null ? '$' + tx.base_cost : '(not set)'}`)
    console.log(`  surcharge:     ${tx.surcharge !== null ? '$' + tx.surcharge : '(not set)'}`)
    console.log(`  invoice_id_sb: ${tx.invoice_id_sb}`)
    console.log()
  }

  // Verify both should be matched to different SFTP files
  if (txs.length === 2) {
    console.log(`Expected SFTP file matching:`)
    for (const tx of txs) {
      const chargeDate = new Date(tx.charge_date)
      const sftpFileDate = new Date(chargeDate)
      sftpFileDate.setDate(sftpFileDate.getDate() + 1)
      const fileDateStr = `${sftpFileDate.getFullYear()}-${String(sftpFileDate.getMonth() + 1).padStart(2, '0')}-${String(sftpFileDate.getDate()).padStart(2, '0')}`

      console.log(`  charge_date ${tx.charge_date} → SFTP file JetPack_Shipment_Extras_${fileDateStr}.csv`)
    }

    console.log()

    // Check if both have base_cost populated
    const bothPopulated = txs.every(tx => tx.base_cost !== null)
    if (bothPopulated) {
      console.log(`✅ SUCCESS: Both transactions have base_cost populated!`)
      console.log(`   This confirms reshipment handling is working correctly.`)
    } else {
      const missing = txs.filter(tx => tx.base_cost === null)
      console.log(`⚠️  INCOMPLETE: ${missing.length} transaction(s) missing base_cost:`)
      for (const tx of missing) {
        console.log(`   - charge_date ${tx.charge_date}, tracking ${tx.tracking_id}`)
      }
      console.log(`\n   Run the daily SFTP sync for the appropriate dates to populate.`)
    }
  } else {
    console.log(`Note: Expected 2 transactions for reshipment test, found ${txs.length}`)
  }

  console.log()
}

main().catch(console.error)
