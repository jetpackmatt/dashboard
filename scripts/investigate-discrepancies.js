/**
 * Investigate reconciliation discrepancies between transactions and invoices
 * Goal: Find exactly WHY we have differences between tx totals and invoice amounts
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fee to invoice type mapping (must match fee-invoice-mapping.ts)
const FEE_TO_INVOICE_TYPE = {
  'Shipping': 'Shipping',
  'Address Correction': 'Shipping',
  'Per Pick Fee': 'AdditionalFee',
  'B2B - Case Pick Fee': 'AdditionalFee',
  'B2B - Each Pick Fee': 'AdditionalFee',
  'B2B - Order Fee': 'AdditionalFee',
  'B2B - Label Fee': 'AdditionalFee',
  'B2B - Pallet Material Charge': 'AdditionalFee',
  'B2B - Pallet Pack Fee': 'AdditionalFee',
  'B2B - Supplies': 'AdditionalFee',
  'B2B - ShipBob Freight Fee': 'AdditionalFee',
  'VAS - Paid Requests': 'AdditionalFee',
  'Inventory Placement Program Fee': 'AdditionalFee',
  'WRO Label Fee': 'AdditionalFee',
  'Kitting Fee': 'AdditionalFee',
  'Credit Card Processing Fee': 'AdditionalFee',
  'Warehousing Fee': 'WarehouseStorage',
  'URO Storage Fee': 'WarehouseStorage',
  'WRO Receiving Fee': 'WarehouseInboundFee',
  'Return to sender - Processing Fees': 'ReturnsFee',
  'Return Processed by Operations Fee': 'ReturnsFee',
  'Return Label': 'ReturnsFee',
  'Credit': 'Credits',
  'Payment': 'Payment',
}

function getInvoiceType(fee) {
  if (!fee) return 'AdditionalFee'
  return FEE_TO_INVOICE_TYPE[fee] || 'AdditionalFee'
}

async function getAllTransactions(periodStart, periodEnd) {
  const allTx = []
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .gte('charge_date', periodStart)
      .lte('charge_date', periodEnd)
      .range(offset, offset + batchSize - 1)
      .order('id')

    if (error) {
      console.error('Error fetching transactions:', error)
      break
    }
    if (!data || data.length === 0) break

    allTx.push(...data)
    offset += data.length
    process.stdout.write(`\rFetched ${allTx.length} transactions...`)

    if (data.length < batchSize) break
  }
  console.log('')
  return allTx
}

async function main() {
  const periodStart = '2025-11-24'
  const periodEnd = '2025-11-30'

  console.log('='.repeat(70))
  console.log('INVESTIGATING RECONCILIATION DISCREPANCIES')
  console.log(`Period: ${periodStart} to ${periodEnd}`)
  console.log('='.repeat(70))

  // Get ALL transactions in period (paginated)
  const transactions = await getAllTransactions(periodStart, periodEnd)
  console.log(`\nTotal transactions: ${transactions.length}`)

  // Get all invoices for this period
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('*')
    .eq('period_start', periodStart)

  console.log(`Invoices for period: ${invoices?.length || 0}`)

  // Aggregate transactions by invoice type
  const txByType = {}
  const txByFee = {}

  for (const tx of transactions) {
    const fee = tx.transaction_fee || 'NULL'
    const invoiceType = getInvoiceType(tx.transaction_fee)

    if (!txByType[invoiceType]) txByType[invoiceType] = { count: 0, total: 0 }
    txByType[invoiceType].count++
    txByType[invoiceType].total += Number(tx.amount)

    if (!txByFee[fee]) txByFee[fee] = { count: 0, total: 0 }
    txByFee[fee].count++
    txByFee[fee].total += Number(tx.amount)
  }

  // Show comparison for each invoice type
  console.log('\n' + '='.repeat(70))
  console.log('COMPARISON BY INVOICE TYPE')
  console.log('='.repeat(70))

  const invByType = {}
  for (const inv of (invoices || [])) {
    invByType[inv.invoice_type] = Number(inv.base_amount)
  }

  const types = ['Shipping', 'AdditionalFee', 'WarehouseStorage', 'WarehouseInboundFee', 'ReturnsFee', 'Credits']

  console.log('\nType                 | Transactions        | Invoice         | Diff')
  console.log('-'.repeat(75))

  let totalTx = 0
  let totalInv = 0

  for (const type of types) {
    const txAmt = txByType[type]?.total || 0
    const invAmt = invByType[type] || 0
    const diff = txAmt - invAmt
    totalTx += txAmt
    totalInv += invAmt

    const diffStr = diff === 0 ? '✓ MATCH' : (diff > 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`)
    console.log(
      `${type.padEnd(20)} | $${txAmt.toFixed(2).padStart(15)} | $${invAmt.toFixed(2).padStart(12)} | ${diffStr}`
    )
  }

  console.log('-'.repeat(75))
  const totalDiff = totalTx - totalInv
  console.log(
    `${'TOTAL'.padEnd(20)} | $${totalTx.toFixed(2).padStart(15)} | $${totalInv.toFixed(2).padStart(12)} | ${totalDiff >= 0 ? '+' : '-'}$${Math.abs(totalDiff).toFixed(2)}`
  )

  // Show all fee types with their invoice type mapping
  console.log('\n' + '='.repeat(70))
  console.log('ALL TRANSACTION FEE TYPES')
  console.log('='.repeat(70))

  const sortedFees = Object.entries(txByFee).sort((a, b) => b[1].total - a[1].total)

  console.log('\nFee Type                           | Invoice Type        | Count   | Amount')
  console.log('-'.repeat(85))

  for (const [fee, data] of sortedFees) {
    const invoiceType = getInvoiceType(fee === 'NULL' ? null : fee)
    const known = fee !== 'NULL' && FEE_TO_INVOICE_TYPE[fee] ? '✓' : '?'
    console.log(
      `${known} ${(fee || 'NULL').padEnd(33)} | ${invoiceType.padEnd(18)} | ${String(data.count).padStart(6)} | $${data.total.toFixed(2)}`
    )
  }

  // Identify specific discrepancies
  console.log('\n' + '='.repeat(70))
  console.log('DISCREPANCY ANALYSIS')
  console.log('='.repeat(70))

  for (const type of types) {
    const txAmt = txByType[type]?.total || 0
    const invAmt = invByType[type] || 0
    const diff = txAmt - invAmt

    if (Math.abs(diff) > 0.01) {
      console.log(`\n${type}: Diff = ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`)

      // List contributing fee types
      const contributingFees = sortedFees.filter(([fee]) => {
        const invType = getInvoiceType(fee === 'NULL' ? null : fee)
        return invType === type
      })

      console.log('  Contributing fee types:')
      for (const [fee, data] of contributingFees) {
        console.log(`    - ${fee}: ${data.count} tx, $${data.total.toFixed(2)}`)
      }
    }
  }

  // Check for any transactions that might be double-counted or missing
  console.log('\n' + '='.repeat(70))
  console.log('CHECKING FOR DATA ISSUES')
  console.log('='.repeat(70))

  // Check for duplicate transaction IDs
  const txIds = transactions.map(tx => tx.shipbob_transaction_id)
  const uniqueIds = new Set(txIds)
  const dupes = txIds.length - uniqueIds.size
  console.log(`\nDuplicate transaction IDs: ${dupes}`)

  // Check for NULL fee types
  const nullFeeTx = transactions.filter(tx => !tx.transaction_fee)
  console.log(`Transactions with NULL fee type: ${nullFeeTx.length}`)
  if (nullFeeTx.length > 0) {
    console.log('  Sample NULL fee transactions:')
    for (const tx of nullFeeTx.slice(0, 5)) {
      console.log(`    ${tx.charge_date} | $${Number(tx.amount).toFixed(2)} | ref: ${tx.reference_id} | type: ${tx.reference_type}`)
    }
  }

  // Check for transactions outside the billing week but within our date range
  const invoice = invoices?.[0]
  if (invoice) {
    console.log(`\nInvoice period: ${invoice.period_start} to ${invoice.period_end}`)
  }
}

main().catch(console.error)
