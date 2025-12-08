/**
 * Compare reference invoice XLSX with generated invoice
 *
 * Reads the reference file structure to understand exact format,
 * then generates an invoice for the same period and compares.
 */
require('dotenv').config({ path: '.env.local' })
const ExcelJS = require('exceljs')
const { createClient } = require('@supabase/supabase-js')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function analyzeReferenceFile(filePath) {
  console.log('='.repeat(70))
  console.log('ANALYZING REFERENCE FILE:', path.basename(filePath))
  console.log('='.repeat(70))

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const analysis = {
    sheets: [],
    totalRows: 0
  }

  workbook.eachSheet((sheet, sheetId) => {
    const sheetInfo = {
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      headers: [],
      sampleData: []
    }

    // Get headers (first row)
    const headerRow = sheet.getRow(1)
    headerRow.eachCell((cell, colNum) => {
      sheetInfo.headers.push({
        col: colNum,
        value: cell.value
      })
    })

    // Get sample data (first 3 data rows)
    for (let rowNum = 2; rowNum <= Math.min(4, sheet.rowCount); rowNum++) {
      const row = sheet.getRow(rowNum)
      const rowData = {}
      sheetInfo.headers.forEach((h, idx) => {
        const cell = row.getCell(h.col)
        rowData[h.value] = cell.value
      })
      sheetInfo.sampleData.push(rowData)
    }

    // Get totals row if present
    if (sheet.rowCount > 1) {
      const lastRow = sheet.getRow(sheet.rowCount)
      const firstCell = lastRow.getCell(1).value
      if (firstCell === 'Total' || firstCell === 'Totals') {
        sheetInfo.hasTotalsRow = true
        sheetInfo.totalsRow = {}
        sheetInfo.headers.forEach(h => {
          const cell = lastRow.getCell(h.col)
          if (cell.value !== null && cell.value !== undefined) {
            sheetInfo.totalsRow[h.value] = cell.value
          }
        })
      }
    }

    analysis.sheets.push(sheetInfo)
    analysis.totalRows += sheet.rowCount - 1 // Exclude header
  })

  return analysis
}

function printAnalysis(analysis) {
  console.log('\nSheets found:', analysis.sheets.length)
  console.log('Total data rows:', analysis.totalRows)

  for (const sheet of analysis.sheets) {
    console.log('\n' + '-'.repeat(60))
    console.log('Sheet:', sheet.name)
    console.log('Rows:', sheet.rowCount - 1, '(excluding header)')
    console.log('Columns:', sheet.headers.length)

    console.log('\nHeaders:')
    sheet.headers.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.value}`)
    })

    if (sheet.sampleData.length > 0) {
      console.log('\nSample data (first row):')
      const sample = sheet.sampleData[0]
      for (const [key, value] of Object.entries(sample)) {
        if (value !== null && value !== undefined && value !== '') {
          console.log(`  ${key}: ${value}`)
        }
      }
    }

    if (sheet.hasTotalsRow) {
      console.log('\nTotals row:')
      for (const [key, value] of Object.entries(sheet.totalsRow)) {
        if (typeof value === 'number') {
          console.log(`  ${key}: $${value.toFixed(2)}`)
        }
      }
    }
  }
}

async function getHensonClientId() {
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, short_code')
    .eq('short_code', 'HS')
    .single()

  return client
}

async function compareBillingData(clientId, periodStart, periodEnd) {
  console.log('\n' + '='.repeat(70))
  console.log('BILLING DATA FROM DATABASE')
  console.log('Period:', periodStart, 'to', periodEnd)
  console.log('='.repeat(70))

  // Shipments
  const { data: shipments, count: shipCount } = await supabase
    .from('billing_shipments')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .gte('transaction_date', periodStart)
    .lte('transaction_date', periodEnd)
    .limit(5)

  console.log('\nShipments:', shipCount)
  if (shipments && shipments.length > 0) {
    console.log('Sample:')
    const s = shipments[0]
    console.log('  Order ID:', s.order_id)
    console.log('  Shipment ID:', s.shipment_id)
    console.log('  Customer:', s.customer_name)
    console.log('  Amount:', s.total_amount)
    console.log('  Carrier:', s.carrier_name, s.ship_option_name)
    console.log('  Date:', s.transaction_date)
  }

  // Shipment fees
  const { count: feeCount } = await supabase
    .from('billing_shipment_fees')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('transaction_date', periodStart)
    .lte('transaction_date', periodEnd)

  console.log('\nShipment Fees:', feeCount)

  // Storage
  const { count: storageCount } = await supabase
    .from('billing_storage')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('charge_start_date', periodStart)
    .lte('charge_start_date', periodEnd)

  console.log('Storage:', storageCount)

  // Returns
  const { count: returnCount } = await supabase
    .from('billing_returns')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('return_creation_date', periodStart)
    .lte('return_creation_date', periodEnd)

  console.log('Returns:', returnCount)

  // Receiving
  const { count: receivingCount } = await supabase
    .from('billing_receiving')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('transaction_date', periodStart)
    .lte('transaction_date', periodEnd)

  console.log('Receiving:', receivingCount)

  // Credits
  const { count: creditCount } = await supabase
    .from('billing_credits')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('transaction_date', periodStart)
    .lte('transaction_date', periodEnd)

  console.log('Credits:', creditCount)

  return {
    shipments: shipCount,
    fees: feeCount,
    storage: storageCount,
    returns: returnCount,
    receiving: receivingCount,
    credits: creditCount
  }
}

async function main() {
  // 1. Analyze reference file
  const refPath = './reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx'
  const analysis = await analyzeReferenceFile(refPath)
  printAnalysis(analysis)

  // 2. Get Henson client
  const client = await getHensonClientId()
  if (!client) {
    console.log('\nError: Henson client not found')
    return
  }
  console.log('\n' + '='.repeat(70))
  console.log('Client:', client.company_name, '(' + client.short_code + ')')

  // Invoice JPHS-0037-120125 would be for the week ending Dec 1, 2025
  // Assuming it's Monday's date format, period would be Nov 25 - Dec 1, 2025
  const periodStart = '2025-11-25'
  const periodEnd = '2025-12-01'

  // 3. Get our billing data for the same period
  const dbCounts = await compareBillingData(client.id, periodStart, periodEnd)

  // 4. Compare counts
  console.log('\n' + '='.repeat(70))
  console.log('COMPARISON')
  console.log('='.repeat(70))

  const refShipments = analysis.sheets.find(s => s.name === 'Shipments')
  const refFees = analysis.sheets.find(s => s.name === 'Additional Services')
  const refStorage = analysis.sheets.find(s => s.name === 'Storage')
  const refReturns = analysis.sheets.find(s => s.name === 'Returns')
  const refReceiving = analysis.sheets.find(s => s.name === 'Receiving')
  const refCredits = analysis.sheets.find(s => s.name === 'Credits')

  console.log('\n           | Reference | Database | Match')
  console.log('-'.repeat(50))
  console.log(`Shipments  | ${String(refShipments?.rowCount - 1 || 0).padStart(9)} | ${String(dbCounts.shipments || 0).padStart(8)} | ${(refShipments?.rowCount - 1 || 0) === (dbCounts.shipments || 0) ? '✓' : '✗'}`)
  console.log(`Add. Svcs  | ${String(refFees?.rowCount - 1 || 0).padStart(9)} | ${String(dbCounts.fees || 0).padStart(8)} | ${(refFees?.rowCount - 1 || 0) === (dbCounts.fees || 0) ? '✓' : '✗'}`)
  console.log(`Storage    | ${String(refStorage?.rowCount - 1 || 0).padStart(9)} | ${String(dbCounts.storage || 0).padStart(8)} | ${(refStorage?.rowCount - 1 || 0) === (dbCounts.storage || 0) ? '✓' : '✗'}`)
  console.log(`Returns    | ${String(refReturns?.rowCount - 1 || 0).padStart(9)} | ${String(dbCounts.returns || 0).padStart(8)} | ${(refReturns?.rowCount - 1 || 0) === (dbCounts.returns || 0) ? '✓' : '✗'}`)
  console.log(`Receiving  | ${String(refReceiving?.rowCount - 1 || 0).padStart(9)} | ${String(dbCounts.receiving || 0).padStart(8)} | ${(refReceiving?.rowCount - 1 || 0) === (dbCounts.receiving || 0) ? '✓' : '✗'}`)
  console.log(`Credits    | ${String(refCredits?.rowCount - 1 || 0).padStart(9)} | ${String(dbCounts.credits || 0).padStart(8)} | ${(refCredits?.rowCount - 1 || 0) === (dbCounts.credits || 0) ? '✓' : '✗'}`)
}

main().catch(console.error)
