/**
 * Check if unmatched Shipping reference IDs exist in XLS Shipping tabs
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')
const fs = require('fs')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

async function check() {
  // Get sample unmatched Shipping reference_ids
  const { data: shipping } = await supabase
    .from('transactions')
    .select('reference_id, charge_date')
    .is('invoice_id_jp', null)
    .eq('transaction_fee', 'Shipping')
    .lte('charge_date', '2025-12-01')
    .limit(20)

  console.log('Sample unmatched Shipping IDs:')
  shipping?.forEach(r => console.log(`  ${r.reference_id} (${r.charge_date})`))

  const sampleIds = shipping?.map(r => r.reference_id) || []

  // Build set of ALL OrderIDs from XLS Shipping tabs
  const files = fs.readdirSync(HISTORICAL_DIR).filter(f => f.endsWith('.xlsx'))
  const allXlsOrderIds = new Set()

  for (const file of files) {
    const xlsPath = path.join(HISTORICAL_DIR, file)
    const workbook = XLSX.readFile(xlsPath)

    const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))
    if (!sheetName) continue

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    rows.forEach(row => {
      const id = String(row['OrderID'] || row['Store OrderID'] || '').trim()
      if (id && id !== 'undefined') allXlsOrderIds.add(id)
    })
  }

  console.log('\nTotal unique OrderIDs in XLS Shipping tabs:', allXlsOrderIds.size)

  // Check which sample IDs exist
  const found = sampleIds.filter(id => allXlsOrderIds.has(id))
  const notFound = sampleIds.filter(id => !allXlsOrderIds.has(id))

  console.log('\nFrom sample:')
  console.log('  Found in XLS:', found.length)
  console.log('  NOT found in XLS:', notFound.length)
  if (notFound.length > 0) {
    console.log('  Sample not found:', notFound.slice(0, 10))
  }
}

check().catch(console.error)
