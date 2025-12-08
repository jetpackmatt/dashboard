/**
 * Check if ULID decode works for Returns, Receiving, and Storage
 * Compare against reference XLSX timestamps
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ULID decode
const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function decodeUlidTimestamp(ulid) {
  if (!ulid || ulid.length < 10) return null
  const timeStr = ulid.substring(0, 10).toUpperCase()
  let time = 0
  for (const char of timeStr) {
    const index = ULID_ENCODING.indexOf(char)
    if (index === -1) return null
    time = time * 32 + index
  }
  return new Date(time)
}

function excelDateToISO(serial) {
  if (typeof serial !== 'number') return String(serial)
  const date = new Date((serial - 25569) * 86400 * 1000)
  return date.toISOString()
}

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const invoiceIds = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

  // Load reference file
  const refPath = path.join(__dirname, '../reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const workbook = XLSX.readFile(refPath)

  console.log('='.repeat(70))
  console.log('ULID TIMESTAMP CHECK FOR ALL TRANSACTION TYPES')
  console.log('='.repeat(70))

  // ========== RETURNS ==========
  console.log('\n\n' + '='.repeat(70))
  console.log('RETURNS')
  console.log('='.repeat(70))

  const returnsSheet = workbook.Sheets['Returns']
  const returnsRef = XLSX.utils.sheet_to_json(returnsSheet).filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')
  console.log('Reference rows:', returnsRef.length)
  console.log('Reference columns:', Object.keys(returnsRef[0] || {}))

  // Check what date columns exist in reference
  const returnsSample = returnsRef[0]
  console.log('\nReference sample row:')
  for (const [key, val] of Object.entries(returnsSample || {})) {
    console.log(`  ${key}: ${val} (${typeof val})`)
    if (typeof val === 'number' && val > 40000 && val < 50000) {
      console.log(`    -> Converted: ${excelDateToISO(val)}`)
    }
  }

  // Get DB returns
  const { data: returnsDb } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, cost, additional_details')
    .eq('client_id', hensonId)
    .eq('reference_type', 'Return')
    .in('invoice_id_sb', invoiceIds)

  console.log('\nDB returns:', returnsDb?.length || 0)
  if (returnsDb?.length > 0) {
    console.log('\nComparing ULID timestamps:')
    for (const tx of returnsDb.slice(0, 5)) {
      const ulidDate = decodeUlidTimestamp(tx.transaction_id)
      console.log(`  Ref ID: ${tx.reference_id}`)
      console.log(`    charge_date: ${tx.charge_date}`)
      console.log(`    ULID decoded: ${ulidDate?.toISOString() || 'invalid'}`)
      console.log()
    }
  }

  // ========== RECEIVING ==========
  console.log('\n\n' + '='.repeat(70))
  console.log('RECEIVING')
  console.log('='.repeat(70))

  const receivingSheet = workbook.Sheets['Receiving']
  const receivingRef = XLSX.utils.sheet_to_json(receivingSheet).filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')
  console.log('Reference rows:', receivingRef.length)
  console.log('Reference columns:', Object.keys(receivingRef[0] || {}))

  const receivingSample = receivingRef[0]
  console.log('\nReference sample row:')
  for (const [key, val] of Object.entries(receivingSample || {})) {
    console.log(`  ${key}: ${val} (${typeof val})`)
    if (typeof val === 'number' && val > 40000 && val < 50000) {
      console.log(`    -> Converted: ${excelDateToISO(val)}`)
    }
  }

  // Get DB receiving (WRO)
  const { data: receivingDb } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, cost, additional_details')
    .eq('client_id', hensonId)
    .eq('reference_type', 'WRO')
    .in('invoice_id_sb', invoiceIds)

  console.log('\nDB receiving (WRO):', receivingDb?.length || 0)
  if (receivingDb?.length > 0) {
    console.log('\nComparing ULID timestamps:')
    for (const tx of receivingDb.slice(0, 5)) {
      const ulidDate = decodeUlidTimestamp(tx.transaction_id)
      console.log(`  Ref ID: ${tx.reference_id}`)
      console.log(`    charge_date: ${tx.charge_date}`)
      console.log(`    ULID decoded: ${ulidDate?.toISOString() || 'invalid'}`)
      console.log()
    }
  }

  // ========== STORAGE ==========
  console.log('\n\n' + '='.repeat(70))
  console.log('STORAGE (re-check)')
  console.log('='.repeat(70))

  const storageSheet = workbook.Sheets['Storage']
  const storageRef = XLSX.utils.sheet_to_json(storageSheet).filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')
  console.log('Reference rows:', storageRef.length)

  // Get unique ChargeStartdate values from reference
  const refDates = new Set()
  for (const row of storageRef) {
    if (typeof row['ChargeStartdate'] === 'number') {
      const dateStr = excelDateToISO(row['ChargeStartdate']).split('T')[0]
      refDates.add(dateStr)
    }
  }
  console.log('Reference unique dates:', [...refDates].sort())

  // Get DB storage with ULID decode
  const { data: storageDb } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, cost')
    .eq('client_id', hensonId)
    .eq('reference_type', 'FC')
    .in('invoice_id_sb', invoiceIds)
    .limit(100)

  console.log('\nDB storage (sample):', storageDb?.length || 0)

  // Decode ULID and see what dates we get
  const ulidDates = new Set()
  for (const tx of storageDb || []) {
    const ulidDate = decodeUlidTimestamp(tx.transaction_id)
    if (ulidDate) {
      ulidDates.add(ulidDate.toISOString().split('T')[0])
    }
  }
  console.log('ULID decoded unique dates:', [...ulidDates].sort())

  // Compare
  console.log('\n--- STORAGE ULID vs Reference ---')
  console.log('Reference dates:', [...refDates].sort().join(', '))
  console.log('ULID dates:', [...ulidDates].sort().join(', '))
  console.log('Match:', [...refDates].sort().join(',') === [...ulidDates].sort().join(',') ? 'YES' : 'NO')

  // ========== SUMMARY ==========
  console.log('\n\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log('Credits: ULID works (confirmed earlier)')
  console.log('Returns: Check above')
  console.log('Receiving: Check above')
  console.log('Storage: Check above')
}

main().catch(console.error)
