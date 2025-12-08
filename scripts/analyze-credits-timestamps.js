/**
 * Analyze Credits tab timestamps in reference file vs our DB
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function excelDateToISO(serial) {
  if (typeof serial !== 'number') return String(serial)
  // Excel serial to JS date
  const date = new Date((serial - 25569) * 86400 * 1000)
  return date.toISOString()
}

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const invoiceIds = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

  console.log('='.repeat(70))
  console.log('CREDITS TIMESTAMP ANALYSIS')
  console.log('='.repeat(70))

  // Load reference file
  const refPath = path.join(__dirname, '../reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const workbook = XLSX.readFile(refPath)
  const creditsSheet = workbook.Sheets['Credits']
  const refData = XLSX.utils.sheet_to_json(creditsSheet)

  // Filter out Total row
  const refRows = refData.filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')

  console.log('\n--- REFERENCE FILE CREDITS ---')
  console.log('Total rows:', refRows.length)
  console.log('\nColumn names:', Object.keys(refRows[0] || {}))
  console.log('\nSample rows:')
  for (const row of refRows.slice(0, 5)) {
    console.log('\n  Row:')
    for (const [key, val] of Object.entries(row)) {
      if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time')) {
        console.log(`    ${key}: ${val} (type: ${typeof val})`)
        if (typeof val === 'number' && val > 40000 && val < 50000) {
          console.log(`      -> Converted: ${excelDateToISO(val)}`)
        }
      } else {
        console.log(`    ${key}: ${val}`)
      }
    }
  }

  // Load DB data
  console.log('\n--- DATABASE CREDITS ---')
  const { data: dbCredits, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', hensonId)
    .eq('transaction_fee', 'Credit')
    .in('invoice_id_sb', invoiceIds)

  if (error) {
    console.log('Error:', error.message)
    return
  }

  console.log('Total rows:', dbCredits?.length || 0)
  console.log('\nSample DB records:')
  for (const tx of (dbCredits || []).slice(0, 5)) {
    console.log('\n  Transaction:', tx.transaction_id)
    console.log('    charge_date:', tx.charge_date)
    console.log('    cost:', tx.cost)
    console.log('    reference_id:', tx.reference_id)
    console.log('    additional_details:', JSON.stringify(tx.additional_details))
    console.log('    created_at (sync time):', tx.created_at)
  }

  // Check ShipBob API for raw credit data
  console.log('\n--- CHECKING SHIPBOB API ---')
  const token = process.env.SHIPBOB_API_TOKEN
  if (!token) {
    console.log('No SHIPBOB_API_TOKEN')
    return
  }

  // Get one credit transaction from API
  const creditsInvoiceId = 8633641  // Credits invoice
  const response = await fetch(
    `https://api.shipbob.com/2025-07/invoices/${creditsInvoiceId}/transactions?pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (response.ok) {
    const data = await response.json()
    const items = Array.isArray(data) ? data : (data.items || [])
    const credits = items.filter(t => t.transaction_fee === 'Credit')

    console.log('\nRaw API Credit transactions:')
    for (const tx of credits.slice(0, 3)) {
      console.log('\n  Transaction:', tx.transaction_id)
      console.log('  Raw JSON:')
      console.log(JSON.stringify(tx, null, 4))
    }
  } else {
    console.log(`API Error: ${response.status}`)
  }
}

main().catch(console.error)
