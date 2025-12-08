/**
 * Investigate why certain transactions didn't match during import
 * Focus on: Additional Services (52), Credits (2), and sample Shipping
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

// Parse import log to find specific not-found items
async function parseLogForNotFound() {
  const logPath = '/tmp/import-historical-full.log'
  if (!fs.existsSync(logPath)) {
    console.log('Log file not found, will analyze XLS files directly')
    return null
  }

  const logContent = fs.readFileSync(logPath, 'utf8')
  const lines = logContent.split('\n')

  // Extract invoice results with not-found counts
  const invoiceResults = []
  let currentInvoice = null

  for (const line of lines) {
    if (line.includes('Processing:')) {
      currentInvoice = line.match(/Processing: (INVOICE-DETAILS-[^.]+\.xlsx)/)?.[1]
    }
    if (line.includes('not found') && currentInvoice) {
      const match = line.match(/(\d+) matched, (\d+) not found/)
      if (match) {
        invoiceResults.push({
          invoice: currentInvoice,
          matched: parseInt(match[1]),
          notFound: parseInt(match[2]),
          type: line.includes('Shipping') ? 'shipping' :
                line.includes('Additional') ? 'additional' :
                line.includes('Credits') ? 'credits' :
                line.includes('Storage') ? 'storage' : 'other'
        })
      }
    }
  }

  return invoiceResults.filter(r => r.notFound > 0)
}

async function analyzeAdditionalServicesNotFound() {
  console.log('\n' + '='.repeat(70))
  console.log('ADDITIONAL SERVICES - DEEP INVESTIGATION')
  console.log('='.repeat(70))

  // Get all XLS files
  const files = fs.readdirSync(HISTORICAL_DIR)
    .filter(f => f.endsWith('.xlsx') && f.includes('DETAILS'))
    .sort()

  const allNotFoundIds = []

  for (const filename of files) {
    const filePath = path.join(HISTORICAL_DIR, filename)
    const workbook = XLSX.readFile(filePath)

    // Find Additional Services/Fees tab
    const sheetName = workbook.SheetNames.find(n =>
      n.toLowerCase().includes('additional')
    )
    if (!sheetName) continue

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    // Get reference IDs from XLS
    for (const row of rows) {
      const refId = row['Reference ID'] || row['ReferenceID'] || row['Reference Number']
      if (refId && refId !== 'Total') {
        // Check if this ID exists in DB
        const { data, error } = await supabase
          .from('transactions')
          .select('transaction_id, reference_id, transaction_fee, client_id, jetpack_invoice_id')
          .eq('reference_id', String(refId))
          .limit(1)

        if (!data || data.length === 0) {
          allNotFoundIds.push({
            invoice: filename,
            refId: String(refId),
            chargeType: row['Charge Type'] || row['ChargeType'] || row['Fee Type'],
            amount: row['Invoiced Amount'] || row['Invoice Amount'] || row['Amount'],
            existsInDb: false
          })
        } else {
          // ID exists but may have wrong attributes
          const dbRow = data[0]
          if (!dbRow.jetpack_invoice_id) {
            // Should have been matched but wasn't
            allNotFoundIds.push({
              invoice: filename,
              refId: String(refId),
              chargeType: row['Charge Type'] || row['ChargeType'] || row['Fee Type'],
              amount: row['Invoiced Amount'] || row['Invoice Amount'] || row['Amount'],
              existsInDb: true,
              dbFee: dbRow.transaction_fee,
              dbClientId: dbRow.client_id,
              dbTransactionId: dbRow.transaction_id
            })
          }
        }
      }
    }
  }

  console.log(`\nTotal Additional Services with potential issues: ${allNotFoundIds.length}`)

  // Group by reason
  const notInDb = allNotFoundIds.filter(r => !r.existsInDb)
  const inDbNotMatched = allNotFoundIds.filter(r => r.existsInDb)

  console.log(`\n  Not in DB at all: ${notInDb.length}`)
  if (notInDb.length > 0) {
    console.log('  Sample not in DB:')
    notInDb.slice(0, 10).forEach(r => {
      console.log(`    ${r.invoice}: refId=${r.refId}, type=${r.chargeType}, amt=${r.amount}`)
    })
  }

  console.log(`\n  In DB but not matched: ${inDbNotMatched.length}`)
  if (inDbNotMatched.length > 0) {
    console.log('  Sample in DB but not matched:')
    inDbNotMatched.slice(0, 10).forEach(r => {
      console.log(`    ${r.invoice}: refId=${r.refId}`)
      console.log(`      XLS type: ${r.chargeType}, DB type: ${r.dbFee}`)
      console.log(`      DB transaction_id: ${r.dbTransactionId}`)
    })
  }

  return { notInDb, inDbNotMatched }
}

async function analyzeCreditsNotFound() {
  console.log('\n' + '='.repeat(70))
  console.log('CREDITS - DEEP INVESTIGATION')
  console.log('='.repeat(70))

  const files = fs.readdirSync(HISTORICAL_DIR)
    .filter(f => f.endsWith('.xlsx') && f.includes('DETAILS'))
    .sort()

  const allCredits = []

  for (const filename of files) {
    const filePath = path.join(HISTORICAL_DIR, filename)
    const workbook = XLSX.readFile(filePath)

    const sheetName = workbook.SheetNames.find(n =>
      n.toLowerCase().includes('credit')
    )
    if (!sheetName) continue

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    for (const row of rows) {
      const refId = row['Reference ID'] || row['ReferenceID'] || row['Reference Number'] ||
                    row['Credit ID'] || row['CreditID']
      if (refId && String(refId) !== 'Total') {
        // Check DB
        const { data } = await supabase
          .from('transactions')
          .select('transaction_id, reference_id, transaction_fee, client_id, jetpack_invoice_id')
          .eq('reference_id', String(refId))
          .limit(1)

        allCredits.push({
          invoice: filename,
          refId: String(refId),
          creditType: row['Credit Type'] || row['Type'],
          amount: row['Credit Amount'] || row['Amount'],
          existsInDb: data && data.length > 0,
          dbRow: data?.[0]
        })
      }
    }
  }

  console.log(`\nTotal Credits analyzed: ${allCredits.length}`)

  const notInDb = allCredits.filter(c => !c.existsInDb)
  const notMatched = allCredits.filter(c => c.existsInDb && !c.dbRow?.jetpack_invoice_id)
  const matched = allCredits.filter(c => c.existsInDb && c.dbRow?.jetpack_invoice_id)

  console.log(`  Not in DB: ${notInDb.length}`)
  console.log(`  In DB, not matched: ${notMatched.length}`)
  console.log(`  In DB, matched: ${matched.length}`)

  if (notInDb.length > 0) {
    console.log('\n  Credits not in DB:')
    notInDb.forEach(c => {
      console.log(`    ${c.invoice}: refId=${c.refId}, type=${c.creditType}, amt=${c.amount}`)
    })
  }

  if (notMatched.length > 0) {
    console.log('\n  Credits in DB but not matched:')
    notMatched.forEach(c => {
      console.log(`    ${c.invoice}: refId=${c.refId}, type=${c.creditType}`)
      console.log(`      DB fee: ${c.dbRow.transaction_fee}, client: ${c.dbRow.client_id}`)
    })
  }

  return { notInDb, notMatched }
}

async function analyzeShippingNotFound() {
  console.log('\n' + '='.repeat(70))
  console.log('SHIPPING - SAMPLE INVESTIGATION (JPHS-0001)')
  console.log('='.repeat(70))

  // Focus on JPHS-0001 which had 645 not found
  const filename = 'INVOICE-DETAILS-JPHS-0001-031525.xlsx'
  const filePath = path.join(HISTORICAL_DIR, filename)

  if (!fs.existsSync(filePath)) {
    console.log('JPHS-0001 file not found')
    return
  }

  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames.find(n =>
    n.toLowerCase().includes('ship')
  )

  if (!sheetName) {
    console.log('No shipping sheet found')
    return
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`\nXLS has ${rows.length} shipping rows`)
  console.log('Headers:', Object.keys(rows[0] || {}))

  // Sample first 20 OrderIDs
  const sampleIds = rows.slice(0, 20).map(r => {
    const orderId = r['OrderID'] || r['Order ID'] || r['Shipment ID'] || r['ShipmentID']
    return String(orderId)
  }).filter(Boolean)

  console.log('\nSample OrderIDs from XLS:', sampleIds)

  // Check which exist in DB
  const { data: dbRows } = await supabase
    .from('transactions')
    .select('reference_id, transaction_fee, charge_date, jetpack_invoice_id')
    .in('reference_id', sampleIds)

  console.log(`\nOf sample ${sampleIds.length}, found ${dbRows?.length || 0} in DB:`)

  if (dbRows) {
    const foundIds = new Set(dbRows.map(r => r.reference_id))
    const missing = sampleIds.filter(id => !foundIds.has(id))

    console.log('  Found:', [...foundIds])
    console.log('  Missing:', missing)

    // For missing, check if they exist with different reference format
    if (missing.length > 0) {
      console.log('\n  Searching for missing IDs with LIKE pattern...')
      for (const id of missing.slice(0, 5)) {
        const { data: likeResults } = await supabase
          .from('transactions')
          .select('reference_id, transaction_fee')
          .like('reference_id', `%${id}%`)
          .limit(5)

        if (likeResults && likeResults.length > 0) {
          console.log(`    ${id} found as:`, likeResults.map(r => r.reference_id))
        } else {
          console.log(`    ${id}: NOT FOUND anywhere in DB`)
        }
      }
    }
  }

  // Check date range of XLS shipments
  console.log('\n  Date range analysis...')
  const dates = rows.map(r => r['Ship Date'] || r['ShipDate'] || r['Date']).filter(Boolean)
  const uniqueDates = [...new Set(dates)].sort()
  console.log('  XLS date range:', uniqueDates[0], 'to', uniqueDates[uniqueDates.length - 1])

  // Count by date
  const dateCounts = {}
  dates.forEach(d => {
    dateCounts[d] = (dateCounts[d] || 0) + 1
  })
  console.log('  Counts by date:', dateCounts)
}

async function checkDbShippingDates() {
  console.log('\n' + '='.repeat(70))
  console.log('DB SHIPPING DATE RANGE CHECK')
  console.log('='.repeat(70))

  // Get earliest and latest shipping transactions
  const { data: earliest } = await supabase
    .from('transactions')
    .select('charge_date, reference_id')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .order('charge_date', { ascending: true })
    .limit(5)

  const { data: latest } = await supabase
    .from('transactions')
    .select('charge_date, reference_id')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .order('charge_date', { ascending: false })
    .limit(5)

  console.log('\nEarliest shipping in DB:', earliest?.map(r => `${r.charge_date} (${r.reference_id})`))
  console.log('Latest shipping in DB:', latest?.map(r => `${r.charge_date} (${r.reference_id})`))

  // Count by date for early March
  const { data: marchCounts } = await supabase
    .rpc('count_by_date', { start_date: '2025-03-01', end_date: '2025-03-20' })

  // If RPC doesn't exist, do it manually
  const { data: marchData } = await supabase
    .from('transactions')
    .select('charge_date')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .gte('charge_date', '2025-03-01')
    .lte('charge_date', '2025-03-20')

  if (marchData) {
    const counts = {}
    marchData.forEach(r => {
      counts[r.charge_date] = (counts[r.charge_date] || 0) + 1
    })
    console.log('\nDB shipping counts March 1-20:')
    Object.entries(counts).sort().forEach(([date, count]) => {
      console.log(`  ${date}: ${count}`)
    })
  }
}

async function main() {
  console.log('INVOICE IMPORT MISMATCH INVESTIGATION')
  console.log('=====================================\n')

  await analyzeAdditionalServicesNotFound()
  await analyzeCreditsNotFound()
  await analyzeShippingNotFound()
  await checkDbShippingDates()

  console.log('\n' + '='.repeat(70))
  console.log('INVESTIGATION COMPLETE')
  console.log('='.repeat(70))
}

main().catch(console.error)
