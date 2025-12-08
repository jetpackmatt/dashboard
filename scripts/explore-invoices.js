/**
 * Explore invoices_sb table and compare with transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('INVOICES_SB TABLE EXPLORATION')
  console.log('='.repeat(70))

  // Get all invoices grouped by type
  const { data: allInv, count: invCount } = await supabase
    .from('invoices_sb')
    .select('*', { count: 'exact' })
    .order('invoice_date', { ascending: false })

  console.log('\nTotal invoices in invoices_sb:', invCount)

  // Group by type
  const byType = {}
  for (const inv of allInv || []) {
    byType[inv.invoice_type] = byType[inv.invoice_type] || []
    byType[inv.invoice_type].push(inv)
  }

  console.log('\nBy invoice_type:')
  for (const [type, invoices] of Object.entries(byType)) {
    const total = invoices.reduce((s, i) => s + Number(i.base_amount || 0), 0)
    console.log('  ' + type + ': ' + invoices.length + ' invoices, $' + total.toFixed(2))
  }

  // Show all invoices
  console.log('\n\nALL INVOICES IN DB:')
  console.log('-'.repeat(70))
  for (const inv of allInv || []) {
    console.log(
      inv.invoice_date + ' | ' +
      inv.invoice_type.padEnd(20) + ' | ' +
      ('$' + Number(inv.base_amount).toFixed(2)).padStart(12) + ' | ' +
      'ID: ' + inv.shipbob_invoice_id
    )
  }

  // Check ShipBob Payments transactions
  console.log('\n\n' + '='.repeat(70))
  console.log('SHIPBOB PAYMENTS TRANSACTIONS')
  console.log('='.repeat(70))

  const { data: sbpClient } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('company_name', 'ShipBob Payments')
    .single()

  if (sbpClient) {
    console.log('Client ID:', sbpClient.id)

    const { data: sbpTx, count: txCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('client_id', sbpClient.id)
      .order('charge_date', { ascending: false })
      .limit(20)

    console.log('Total transactions:', txCount)
    console.log('\nSample transactions:')
    for (const tx of sbpTx || []) {
      console.log(
        tx.charge_date + ' | ' +
        (tx.transaction_fee || 'N/A').padEnd(20) + ' | ' +
        ('$' + Number(tx.amount).toFixed(2)).padStart(12) + ' | ' +
        'ref: ' + tx.reference_id
      )
    }
  } else {
    console.log('No ShipBob Payments client found')
  }

  // Summary
  console.log('\n\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`
Invoice Types from ShipBob API (28 total):
- Shipping (4)         - Charges for shipping
- AdditionalFee (4)    - Pick fees, surcharges, etc
- WarehouseStorage (2) - Monthly storage
- WarehouseInboundFee (4) - Receiving charges
- ReturnsFee (4)       - Return processing
- Credits (4)          - Refunds/credits (negative)
- Payment (6)          - Payments made (negative)

Current invoices_sb table: ${invCount} records
(Missing Payment type invoices - need to sync)

DECISION NEEDED:
1. Payment invoices should replace "ShipBob Payments" transactions
2. They track the same thing: payments we make to ShipBob
3. Invoice approach is cleaner - one record per payment vs many transactions
  `)
}

main().catch(console.error)
