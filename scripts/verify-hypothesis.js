/**
 * Verify hypothesis: Unmatched transactions are ones ShipBob didn't bill
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

async function check() {
  console.log('=== VERIFY HYPOTHESIS: DB > XLS BECAUSE SOME NOT CHARGED ===\n')

  // Get JPHS-0001 info
  const { data: jphs0001 } = await supabase
    .from('invoices_jetpack')
    .select('id, period_start, period_end')
    .eq('invoice_number', 'JPHS-0001-032425')
    .single()

  // Read XLS to get actual OrderIDs
  const xlsPath = path.join(HISTORICAL_DIR, 'INVOICE-DETAILS-JPHS-0001-0302425.xlsx')
  const workbook = XLSX.readFile(xlsPath)
  const sheet = workbook.Sheets[workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))]
  const rows = XLSX.utils.sheet_to_json(sheet)

  const xlsOrderIds = new Set()
  rows.forEach(row => {
    const orderId = String(row['OrderID'] || '')
    if (orderId && orderId !== 'undefined') {
      xlsOrderIds.add(orderId)
    }
  })

  console.log('XLS JPHS-0001:')
  console.log(`  Shipping rows: ${rows.length}`)
  console.log(`  Unique OrderIDs: ${xlsOrderIds.size}`)

  // Get ALL shipping transactions in period (paginated)
  let offset = 0
  const batchSize = 1000
  let allDbTxs = []

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('reference_id, cost, invoiced_status_sb, invoice_id_sb')
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
      .gte('charge_date', jphs0001.period_start.slice(0, 10))
      .lte('charge_date', jphs0001.period_end.slice(0, 10))
      .range(offset, offset + batchSize - 1)

    if (error || !data || data.length === 0) break
    allDbTxs = allDbTxs.concat(data)
    offset += batchSize
  }

  console.log(`\nDB transactions in period: ${allDbTxs.length}`)

  // Categorize
  const inXls = allDbTxs.filter(t => xlsOrderIds.has(t.reference_id))
  const notInXls = allDbTxs.filter(t => !xlsOrderIds.has(t.reference_id))

  console.log(`  In XLS: ${inXls.length}`)
  console.log(`  NOT in XLS: ${notInXls.length}`)

  // Check ShipBob invoice status of NOT-in-XLS
  const notInXlsSbStatus = {}
  notInXls.forEach(t => {
    const status = t.invoiced_status_sb === true ? 'Invoiced' :
                   t.invoiced_status_sb === false ? 'Not Invoiced' : 'NULL'
    notInXlsSbStatus[status] = (notInXlsSbStatus[status] || 0) + 1
  })

  console.log('\nNOT-in-XLS transactions by ShipBob invoiced status:')
  for (const [status, count] of Object.entries(notInXlsSbStatus)) {
    console.log(`  ${status}: ${count}`)
  }

  // Cost distribution
  const notInXlsTotalCost = notInXls.reduce((sum, t) => sum + (t.cost || 0), 0)
  const inXlsTotalCost = inXls.reduce((sum, t) => sum + (t.cost || 0), 0)

  console.log('\nCost distribution:')
  console.log(`  In-XLS total cost: $${inXlsTotalCost.toFixed(2)}`)
  console.log(`  NOT-in-XLS total cost: $${notInXlsTotalCost.toFixed(2)}`)

  // Check if NOT-in-XLS are free/zero cost
  const notInXlsZeroCost = notInXls.filter(t => t.cost === 0 || t.cost === null).length
  const notInXlsNegative = notInXls.filter(t => t.cost < 0).length
  const notInXlsPositive = notInXls.filter(t => t.cost > 0).length

  console.log('\nNOT-in-XLS cost breakdown:')
  console.log(`  Zero/null cost: ${notInXlsZeroCost}`)
  console.log(`  Negative cost (credits): ${notInXlsNegative}`)
  console.log(`  Positive cost: ${notInXlsPositive}`)

  // Sample of positive-cost NOT-in-XLS
  const positiveSamples = notInXls.filter(t => t.cost > 0).slice(0, 10)
  console.log('\nSample positive-cost NOT-in-XLS:')
  positiveSamples.forEach(t => {
    console.log(`  ${t.reference_id}: $${t.cost}, SB_invoice=${t.invoice_id_sb}, invoiced=${t.invoiced_status_sb}`)
  })

  // Check ShipBob invoice IDs for NOT-in-XLS
  const notInXlsSbInvoices = {}
  notInXls.forEach(t => {
    if (t.invoice_id_sb) {
      notInXlsSbInvoices[t.invoice_id_sb] = (notInXlsSbInvoices[t.invoice_id_sb] || 0) + 1
    }
  })

  console.log('\nNOT-in-XLS ShipBob invoice distribution:')
  const sortedSbInvoices = Object.entries(notInXlsSbInvoices).sort((a, b) => b[1] - a[1])
  sortedSbInvoices.slice(0, 10).forEach(([inv, count]) => {
    console.log(`  SB Invoice ${inv}: ${count}`)
  })
}

check().catch(console.error)
