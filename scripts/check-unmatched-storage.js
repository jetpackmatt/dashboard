/**
 * Check if unmatched Warehousing Fee inventory IDs exist in XLS Storage tabs
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
  // Get ALL unmatched Warehousing Fee reference_ids
  let allWh = []
  let offset = 0

  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('reference_id')
      .is('invoice_id_jp', null)
      .eq('transaction_fee', 'Warehousing Fee')
      .lte('charge_date', '2025-12-01')
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allWh = allWh.concat(data)
    offset += 1000
    if (data.length < 1000) break
  }

  console.log('Unmatched Warehousing Fee transactions:', allWh.length)

  // Extract inventory IDs (middle number from format like "182-20777282-Shelf")
  const inventoryIds = allWh.map(r => {
    const parts = r.reference_id.split('-')
    return parts.length >= 2 ? parts[1] : null
  }).filter(Boolean)

  const uniqueInventoryIds = [...new Set(inventoryIds)]
  console.log('Unique inventory IDs to match:', uniqueInventoryIds.length)
  console.log('Sample:', uniqueInventoryIds.slice(0, 10))

  // Build set of ALL Inventory IDs from XLS Storage tabs
  const files = fs.readdirSync(HISTORICAL_DIR).filter(f => f.endsWith('.xlsx'))
  const allXlsInventoryIds = new Set()

  for (const file of files) {
    const xlsPath = path.join(HISTORICAL_DIR, file)
    const workbook = XLSX.readFile(xlsPath)

    const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('storage'))
    if (!sheetName) continue

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    rows.forEach(row => {
      const id = String(row['Inventory ID'] || '').trim()
      if (id && id !== 'undefined') allXlsInventoryIds.add(id)
    })
  }

  console.log('\nTotal unique Inventory IDs in XLS Storage tabs:', allXlsInventoryIds.size)

  // Check how many exist in XLS
  const found = uniqueInventoryIds.filter(id => allXlsInventoryIds.has(id))
  const notFound = uniqueInventoryIds.filter(id => !allXlsInventoryIds.has(id))

  console.log('\nMatch results:')
  console.log('  Found in XLS:', found.length)
  console.log('  NOT found in XLS:', notFound.length)

  if (notFound.length > 0 && notFound.length <= 20) {
    console.log('  Not found IDs:', notFound)
  } else if (notFound.length > 20) {
    console.log('  Sample not found:', notFound.slice(0, 20))
  }
}

check().catch(console.error)
