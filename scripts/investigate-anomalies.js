/**
 * Investigate shipments where DB cost > XLSX marked-up amount
 * This shouldn't happen if our data is correct
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Anomalous shipment IDs from previous analysis
  const anomalies = [
    { id: '318576741', xlsxTotal: 19.78, dbTotal: 30.40 },
    { id: '321471504', xlsxTotal: 17.33, dbTotal: 24.65 },
    { id: '319806353', xlsxTotal: 15.29, dbTotal: 75.69 }
  ]

  console.log('='.repeat(70))
  console.log('INVESTIGATING ANOMALOUS SHIPMENTS')
  console.log('(Where DB raw cost > XLSX marked-up amount)')
  console.log('='.repeat(70))

  for (const a of anomalies) {
    console.log('\n' + '-'.repeat(70))
    console.log('Shipment', a.id)
    console.log('  XLSX (correct marked-up): $' + a.xlsxTotal.toFixed(2))
    console.log('  DB (raw cost):            $' + a.dbTotal.toFixed(2))
    console.log('-'.repeat(70))

    // Get ALL transactions for this shipment
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference_id', a.id)
      .eq('reference_type', 'Shipment')

    if (error) {
      console.log('  Error:', error)
      continue
    }

    console.log('\n  Found', txs?.length || 0, 'transactions:')

    for (const tx of txs || []) {
      console.log(`\n  Transaction ID: ${tx.id}`)
      console.log(`    Amount:          $${Number(tx.amount).toFixed(2)}`)
      console.log(`    Fee Type:        ${tx.transaction_fee}`)
      console.log(`    Invoice ID:      ${tx.invoice_id_sb}`)
      console.log(`    Charge Date:     ${tx.charge_date}`)
      console.log(`    Client ID:       ${tx.client_id}`)
    }

    // Check if there are multiple invoices
    const invoiceIds = [...new Set(txs?.map(t => t.invoice_id_sb) || [])]
    if (invoiceIds.length > 1) {
      console.log('\n  ⚠️ MULTIPLE INVOICES:', invoiceIds.join(', '))
    }
  }

  // Also check a normal shipment for comparison
  console.log('\n' + '='.repeat(70))
  console.log('CHECKING A NORMAL SHIPMENT FOR COMPARISON')
  console.log('='.repeat(70))

  const normalShipment = '319804153' // From earlier: XLSX $31.68, DB $28.36
  const { data: normalTxs } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_id', normalShipment)
    .eq('reference_type', 'Shipment')

  console.log('\nShipment', normalShipment)
  console.log('  Expected DB: ~$28.36')
  console.log('  Found', normalTxs?.length || 0, 'transactions:')

  for (const tx of normalTxs || []) {
    console.log(`\n  Transaction ID: ${tx.id}`)
    console.log(`    Amount:          $${Number(tx.amount).toFixed(2)}`)
    console.log(`    Fee Type:        ${tx.transaction_fee}`)
    console.log(`    Invoice ID:      ${tx.invoice_id_sb}`)
  }
}

main().catch(console.error)
