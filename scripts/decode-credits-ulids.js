/**
 * Decode ULID timestamps from Credit transaction_ids
 * to see if they match reference timestamps
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ULID decoding - first 10 chars encode timestamp
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ENCODING_LEN = ENCODING.length

function decodeTime(id) {
  const timeStr = id.substring(0, 10).toUpperCase()
  let time = 0
  for (const char of timeStr) {
    const index = ENCODING.indexOf(char)
    if (index === -1) return null
    time = time * ENCODING_LEN + index
  }
  return new Date(time)
}

// Reference timestamps from XLSX (Excel serial -> ISO)
const referenceTimestamps = {
  '303354434': new Date((45990.187836840276 - 25569) * 86400 * 1000),  // 2025-11-29T04:30:29.103Z
  '309525390': new Date((45987.1908522338 - 25569) * 86400 * 1000),    // 2025-11-26T04:34:49.633Z
  '311350071': new Date((45987.94580559028 - 25569) * 86400 * 1000),   // 2025-11-26T22:41:57.603Z
  '311748201': new Date((45988.19147866898 - 25569) * 86400 * 1000),   // 2025-11-27T04:35:43.757Z
  '311870011': new Date((45985.95741234954 - 25569) * 86400 * 1000),   // 2025-11-24T22:58:40.427Z
}

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const invoiceIds = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

  console.log('='.repeat(70))
  console.log('CREDITS ULID TIMESTAMP DECODE')
  console.log('='.repeat(70))

  const { data: credits } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, cost')
    .eq('client_id', hensonId)
    .eq('transaction_fee', 'Credit')
    .in('invoice_id_sb', invoiceIds)

  console.log('\nComparing ULID timestamps to reference timestamps:\n')
  console.log('Reference ID | Reference Time (from XLSX) | ULID Time (decoded) | Match?')
  console.log('-'.repeat(90))

  for (const tx of credits || []) {
    const ulidTime = decodeTime(tx.transaction_id)
    const refTime = referenceTimestamps[tx.reference_id]

    const refStr = refTime ? refTime.toISOString() : 'N/A'
    const ulidStr = ulidTime ? ulidTime.toISOString() : 'invalid'

    let match = 'N/A'
    if (refTime && ulidTime) {
      const diffMs = Math.abs(refTime.getTime() - ulidTime.getTime())
      if (diffMs < 60000) {
        match = 'YES (< 1 min)'
      } else if (diffMs < 3600000) {
        match = 'CLOSE (' + Math.round(diffMs / 60000) + ' min)'
      } else {
        match = 'NO (' + Math.round(diffMs / 3600000) + ' hrs)'
      }
    }

    console.log(`${tx.reference_id.padEnd(12)} | ${refStr.padEnd(26)} | ${ulidStr.padEnd(26)} | ${match}`)
  }

  // Summary
  console.log('\n--- SUMMARY ---')
  console.log('ULID timestamps decode to when the transaction was CREATED in ShipBob system')
  console.log('Reference timestamps might be from a different source (ticket system?)')
}

main().catch(console.error)
