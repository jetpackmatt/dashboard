/**
 * Test ULID timestamp decoding for Credits, Returns, and Receiving
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

// ULID decode function
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

function excelDateToDate(serial) {
  if (typeof serial !== 'number') return null
  return new Date((serial - 25569) * 86400 * 1000)
}

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const invoiceIds = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

  // Load reference XLSX
  const refPath = path.join(__dirname, '../reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const workbook = XLSX.readFile(refPath)

  console.log('='.repeat(70))
  console.log('ULID TIMESTAMP VERIFICATION')
  console.log('='.repeat(70))

  // ========== CREDITS ==========
  console.log('\n' + '='.repeat(70))
  console.log('CREDITS')
  console.log('='.repeat(70))

  const creditsSheet = workbook.Sheets['Credits']
  const creditsRef = XLSX.utils.sheet_to_json(creditsSheet).filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')

  // Get DB credits
  const { data: creditsDb } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date')
    .eq('client_id', hensonId)
    .eq('reference_type', 'Default')
    .ilike('transaction_fee', '%Credit%')
    .in('invoice_id_sb', invoiceIds)
    .limit(5)

  console.log('Sample Credits Comparison:')
  for (const tx of creditsDb || []) {
    const ulidDate = decodeUlidTimestamp(tx.transaction_id)
    // Find matching reference row
    const refRow = creditsRef.find(r => String(r['Reference ID']) === String(tx.reference_id))
    const refDate = refRow ? excelDateToDate(refRow['Transaction Date']) : null

    console.log(`\n  Reference ID: ${tx.reference_id}`)
    console.log(`    ULID Decoded:  ${ulidDate?.toISOString() || 'N/A'}`)
    console.log(`    Reference:     ${refDate?.toISOString() || 'N/A'}`)
    if (ulidDate && refDate) {
      const diffMs = Math.abs(ulidDate.getTime() - refDate.getTime())
      console.log(`    Difference:    ${diffMs}ms ${diffMs < 1000 ? '✓ MATCH' : diffMs < 60000 ? '~ CLOSE' : '✗ MISMATCH'}`)
    }
  }

  // ========== RETURNS ==========
  console.log('\n' + '='.repeat(70))
  console.log('RETURNS')
  console.log('='.repeat(70))

  const returnsSheet = workbook.Sheets['Returns']
  const returnsRef = XLSX.utils.sheet_to_json(returnsSheet).filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')

  // Show reference columns
  if (returnsRef.length > 0) {
    console.log('Reference columns:', Object.keys(returnsRef[0]).join(', '))
  }

  // Get DB returns
  const { data: returnsDb } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, additional_details')
    .eq('client_id', hensonId)
    .eq('reference_type', 'Return')
    .in('invoice_id_sb', invoiceIds)
    .limit(5)

  console.log('\nSample Returns Comparison:')
  for (const tx of returnsDb || []) {
    const ulidDate = decodeUlidTimestamp(tx.transaction_id)
    // Find matching reference - try RMA ID or Reference ID
    const details = tx.additional_details || {}
    const rmaId = details.RmaId
    const refRow = returnsRef.find(r =>
      String(r['RMA ID']) === String(rmaId) ||
      String(r['Reference ID']) === String(tx.reference_id)
    )

    // Look for date columns in reference
    let refDate = null
    if (refRow) {
      const dateCol = Object.keys(refRow).find(k => k.toLowerCase().includes('date') && typeof refRow[k] === 'number')
      if (dateCol) refDate = excelDateToDate(refRow[dateCol])
    }

    console.log(`\n  Reference ID: ${tx.reference_id} (RMA: ${rmaId || 'N/A'})`)
    console.log(`    ULID Decoded:  ${ulidDate?.toISOString() || 'N/A'}`)
    console.log(`    Reference:     ${refDate?.toISOString() || 'N/A (no date column found)'}`)
    if (ulidDate && refDate) {
      const diffMs = Math.abs(ulidDate.getTime() - refDate.getTime())
      const diffMins = Math.round(diffMs / 60000)
      console.log(`    Difference:    ${diffMins} minutes ${diffMs < 1000 ? '✓ MATCH' : diffMs < 3600000 ? '~ CLOSE' : '✗ MISMATCH'}`)
    }
  }

  // ========== RECEIVING ==========
  console.log('\n' + '='.repeat(70))
  console.log('RECEIVING')
  console.log('='.repeat(70))

  const receivingSheet = workbook.Sheets['Receiving']
  const receivingRef = XLSX.utils.sheet_to_json(receivingSheet).filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')

  // Show reference columns
  if (receivingRef.length > 0) {
    console.log('Reference columns:', Object.keys(receivingRef[0]).join(', '))
  }

  // Get DB receiving
  const { data: receivingDb } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, additional_details')
    .eq('client_id', hensonId)
    .eq('reference_type', 'WRO')
    .in('invoice_id_sb', invoiceIds)
    .limit(5)

  console.log('\nSample Receiving Comparison:')
  for (const tx of receivingDb || []) {
    const ulidDate = decodeUlidTimestamp(tx.transaction_id)
    // Find matching reference - try WRO ID
    const details = tx.additional_details || {}
    const wroId = details.WroId
    const refRow = receivingRef.find(r =>
      String(r['WRO ID']) === String(wroId) ||
      String(r['Reference ID']) === String(tx.reference_id)
    )

    // Look for date columns in reference
    let refDate = null
    let dateColName = null
    if (refRow) {
      const dateCol = Object.keys(refRow).find(k => k.toLowerCase().includes('date') && typeof refRow[k] === 'number')
      if (dateCol) {
        refDate = excelDateToDate(refRow[dateCol])
        dateColName = dateCol
      }
    }

    console.log(`\n  Reference ID: ${tx.reference_id} (WRO: ${wroId || 'N/A'})`)
    console.log(`    ULID Decoded:  ${ulidDate?.toISOString() || 'N/A'}`)
    console.log(`    Reference:     ${refDate?.toISOString() || 'N/A'} ${dateColName ? '(' + dateColName + ')' : ''}`)
    if (ulidDate && refDate) {
      const diffMs = Math.abs(ulidDate.getTime() - refDate.getTime())
      console.log(`    Difference:    ${diffMs}ms ${diffMs < 1000 ? '✓ MATCH' : diffMs < 60000 ? '~ CLOSE' : '✗ MISMATCH'}`)
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log('Credits:   ULID timestamp should match reference within 1ms')
  console.log('Returns:   ULID timestamp may differ by ~30 mins (different event timing)')
  console.log('Receiving: ULID timestamp should match reference within 1ms')
  console.log('Storage:   ULID does NOT work (all decode to period end date)')
}

main().catch(console.error)
