#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

// ULID decoder - first 10 chars encode timestamp in Crockford Base32
function decodeULID(ulid) {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const timeChars = ulid.slice(0, 10)
  let time = 0
  for (const char of timeChars) {
    time = time * 32 + ENCODING.indexOf(char.toUpperCase())
  }
  return new Date(time)
}

async function main() {
  const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: '2025-11-20', end_date: '2025-11-26' })
  })

  const data = await response.json()
  console.log('Decoding transaction timestamps from ULIDs...\n')

  // Group by actual creation date (from ULID)
  const byActualDate = {}
  for (const tx of data.items || []) {
    const actualDate = decodeULID(tx.transaction_id)
    const dateKey = actualDate.toISOString().split('T')[0]
    if (!byActualDate[dateKey]) {
      byActualDate[dateKey] = { count: 0, total: 0 }
    }
    byActualDate[dateKey].count++
    byActualDate[dateKey].total += tx.amount
  }

  console.log('By ACTUAL creation date (decoded from transaction_id ULID):')
  console.log('─'.repeat(55))
  Object.entries(byActualDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, stats]) => {
      console.log(`  ${date}: ${stats.count.toString().padStart(4)} tx, $${stats.total.toFixed(2).padStart(10)}`)
    })

  // Show a few examples
  console.log('\nSample transaction timestamps:')
  for (const tx of (data.items || []).slice(0, 5)) {
    const actual = decodeULID(tx.transaction_id)
    console.log(`  ${tx.transaction_id} -> ${actual.toISOString()}`)
  }

  console.log('\n\nCompare charge_date vs actual ULID date:')
  console.log('─'.repeat(55))
  for (const tx of (data.items || []).slice(0, 10)) {
    const actual = decodeULID(tx.transaction_id)
    console.log(`  charge_date: ${tx.charge_date}  |  ULID date: ${actual.toISOString().split('T')[0]}`)
  }
}

main()
