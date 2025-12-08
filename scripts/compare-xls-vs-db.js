/**
 * Compare JPHS-0001 XLS reference IDs vs DB
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
  console.log('=== JPHS-0001 XLS vs DB COMPARISON ===\n')

  // Read JPHS-0001 XLS (note: 7-digit typo in filename)
  const xlsPath = path.join(HISTORICAL_DIR, 'INVOICE-DETAILS-JPHS-0001-0302425.xlsx')
  const workbook = XLSX.readFile(xlsPath)

  // Find shipping sheet
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))
  if (!sheetName) {
    console.log('No shipping sheet found')
    return
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`XLS shipping sheet: ${sheetName}`)
  console.log(`XLS row count: ${rows.length}`)
  console.log('XLS headers:', Object.keys(rows[0] || {}))

  // Get all OrderIDs from XLS
  const xlsOrderIds = new Set()
  rows.forEach(row => {
    const orderId = String(row['OrderID'] || row['Order ID'] || '')
    if (orderId && orderId !== 'undefined') {
      xlsOrderIds.add(orderId)
    }
  })

  console.log(`\nUnique OrderIDs in XLS: ${xlsOrderIds.size}`)
  console.log('Sample XLS OrderIDs:', [...xlsOrderIds].slice(0, 10))

  // Get shipping transactions from DB for JPHS-0001 period
  const { data: jphs0001 } = await supabase
    .from('invoices_jetpack')
    .select('id, period_start, period_end')
    .eq('invoice_number', 'JPHS-0001-032425')
    .single()

  console.log(`\nJPHS-0001 period: ${jphs0001.period_start.slice(0,10)} to ${jphs0001.period_end.slice(0,10)}`)

  // Get all reference_ids from DB that were matched to JPHS-0001
  const { data: matchedTxs } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('invoice_id_jp', jphs0001.id)
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])

  const dbMatchedIds = new Set(matchedTxs?.map(r => r.reference_id) || [])
  console.log(`DB matched to JPHS-0001: ${dbMatchedIds.size}`)

  // Get all reference_ids from DB in JPHS-0001 period (matched or not)
  const { data: allInPeriod } = await supabase
    .from('transactions')
    .select('reference_id')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  const dbAllIds = new Set(allInPeriod?.map(r => r.reference_id) || [])
  console.log(`DB total in period: ${dbAllIds.size}`)

  // Compare XLS vs DB
  const xlsNotInDb = [...xlsOrderIds].filter(id => !dbAllIds.has(id))
  const dbNotInXls = [...dbAllIds].filter(id => !xlsOrderIds.has(id))
  const inBoth = [...xlsOrderIds].filter(id => dbAllIds.has(id))

  console.log('\n=== COMPARISON ===')
  console.log(`In XLS AND DB: ${inBoth.length}`)
  console.log(`In XLS but NOT in DB: ${xlsNotInDb.length}`)
  console.log(`In DB but NOT in XLS: ${dbNotInXls.length}`)

  if (xlsNotInDb.length > 0) {
    console.log('\nSample XLS IDs not in DB:', xlsNotInDb.slice(0, 10))
  }

  if (dbNotInXls.length > 0) {
    console.log('\nSample DB IDs not in XLS:', dbNotInXls.slice(0, 10))

    // Check what these look like
    const { data: samples } = await supabase
      .from('transactions')
      .select('reference_id, charge_date, cost, invoice_id_sb')
      .in('reference_id', dbNotInXls.slice(0, 5))

    console.log('\nDetails of DB-only transactions:')
    samples?.forEach(s => {
      console.log(`  ${s.reference_id}: ${s.charge_date}, $${s.cost}, SB invoice: ${s.invoice_id_sb}`)
    })
  }

  // Check why matched IDs don't equal XLS IDs
  const xlsMatchedToJphs = [...xlsOrderIds].filter(id => dbMatchedIds.has(id))
  const xlsNotMatchedToJphs = [...xlsOrderIds].filter(id => !dbMatchedIds.has(id))

  console.log('\n=== XLS IDs MATCHING STATUS ===')
  console.log(`XLS IDs matched to JPHS-0001: ${xlsMatchedToJphs.length}`)
  console.log(`XLS IDs NOT matched to JPHS-0001: ${xlsNotMatchedToJphs.length}`)

  if (xlsNotMatchedToJphs.length > 0) {
    console.log('\nSample XLS IDs not matched:', xlsNotMatchedToJphs.slice(0, 10))

    // Check if these exist in DB at all
    const { data: checkExist } = await supabase
      .from('transactions')
      .select('reference_id, charge_date, invoice_id_jp')
      .in('reference_id', xlsNotMatchedToJphs.slice(0, 10))

    console.log('Are these in DB?')
    const foundInDb = new Set(checkExist?.map(r => r.reference_id) || [])
    xlsNotMatchedToJphs.slice(0, 10).forEach(id => {
      const found = checkExist?.find(r => r.reference_id === id)
      if (found) {
        console.log(`  ${id}: YES, invoice_id_jp=${found.invoice_id_jp}`)
      } else {
        console.log(`  ${id}: NO - not in DB`)
      }
    })
  }
}

check().catch(console.error)
