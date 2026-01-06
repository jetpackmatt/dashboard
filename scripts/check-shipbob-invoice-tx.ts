#!/usr/bin/env npx tsx
/**
 * Check what transactions are on ShipBob invoice 8693047 (WarehouseInboundFee)
 * to see if WRO 872067 is there
 */

import 'dotenv/config'
import { ShipBobClient } from '../lib/shipbob/client'

const INVOICE_ID = 8693047  // WarehouseInboundFee invoice

async function main() {
  console.log('='.repeat(60))
  console.log(`Checking ShipBob Invoice ${INVOICE_ID} for WRO 872067`)
  console.log('='.repeat(60))

  const shipbob = new ShipBobClient()

  try {
    // Get transactions for this invoice
    const transactions = await shipbob.billing.getTransactionsByInvoice(INVOICE_ID)

    console.log(`\nFound ${transactions.length} transactions on invoice ${INVOICE_ID}:`)

    // Look for receiving transactions
    const receivingTx = transactions.filter(tx =>
      tx.fee_type === 'Receiving' ||
      tx.reference_type === 'WRO' ||
      (tx.reference_id && tx.reference_id.toString().startsWith('87'))
    )

    console.log(`\nReceiving/WRO transactions:`)
    for (const tx of transactions) {
      if (tx.fee_type === 'Receiving' || tx.reference_type?.includes('WRO')) {
        const isMissing = tx.reference_id?.toString() === '872067'
        console.log(`${isMissing ? '>>> MISSING: ' : '    '}WRO ${tx.reference_id}`)
        console.log(`       tx_id: ${tx.transaction_id}`)
        console.log(`       fee_type: ${tx.fee_type}`)
        console.log(`       total: $${tx.total_charge}`)
        console.log()
      }
    }

    // Also check if 872067 appears anywhere
    const missing = transactions.find(tx => tx.reference_id?.toString() === '872067')
    if (missing) {
      console.log('\n✅ WRO 872067 IS on ShipBob invoice!')
      console.log(JSON.stringify(missing, null, 2))
    } else {
      console.log('\n❌ WRO 872067 NOT found on this invoice')

      // List all WRO-like references
      console.log('\nAll reference_ids on this invoice:')
      const refs = [...new Set(transactions.map(tx => tx.reference_id).filter(Boolean))]
      refs.forEach(r => console.log(`  - ${r}`))
    }

  } catch (err) {
    console.error('Error:', err)
  }
}

main()
