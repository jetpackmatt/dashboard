#!/usr/bin/env node
/**
 * Test if POST /transactions:query needs explicit date params
 * to get transactions from days other than today
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryWithDates(startDate, endDate, label) {
  const body = {
    start_date: startDate,
    end_date: endDate,
    page_size: 250
  }

  const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    return { items: [], label, error: response.status }
  }

  const data = await response.json()
  const items = data.items || []

  // Check actual dates in response
  const dates = items.map(t => t.charge_date).filter(Boolean)
  const uniqueDates = [...new Set(dates)].sort()

  return {
    items,
    label,
    requestedRange: `${startDate} to ${endDate}`,
    actualDates: uniqueDates
  }
}

async function main() {
  console.log('Testing date parameters for POST /transactions:query\n')
  console.log('═'.repeat(70))

  // Test different date formats and ranges
  const tests = [
    // ISO format
    { start: '2025-12-01', end: '2025-12-04', label: 'YYYY-MM-DD format' },
    { start: '2025-12-01T00:00:00Z', end: '2025-12-04T23:59:59Z', label: 'ISO with time' },

    // Individual days
    { start: '2025-12-04', end: '2025-12-04', label: 'Dec 4 only' },
    { start: '2025-12-03', end: '2025-12-03', label: 'Dec 3 only' },
    { start: '2025-12-02', end: '2025-12-02', label: 'Dec 2 only' },
    { start: '2025-12-01', end: '2025-12-01', label: 'Dec 1 only' },

    // Wider range
    { start: '2025-11-27', end: '2025-12-04', label: 'Full week (Nov 27 - Dec 4)' },
  ]

  for (const test of tests) {
    const result = await queryWithDates(test.start, test.end, test.label)
    console.log(`\n${test.label}:`)
    console.log(`  Requested: ${result.requestedRange}`)
    console.log(`  Got: ${result.items.length} transactions`)
    console.log(`  Actual dates: ${result.actualDates.join(', ') || 'none'}`)
  }

  // Now try with from_date/to_date instead
  console.log('\n' + '═'.repeat(70))
  console.log('Testing from_date/to_date (alternative param names)\n')

  const altBody = {
    from_date: '2025-12-01',
    to_date: '2025-12-04',
    page_size: 250
  }

  const altResponse = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(altBody)
  })

  if (altResponse.ok) {
    const altData = await altResponse.json()
    const dates = (altData.items || []).map(t => t.charge_date).filter(Boolean)
    console.log(`from_date/to_date: ${altData.items?.length || 0} transactions`)
    console.log(`Actual dates: ${[...new Set(dates)].sort().join(', ')}`)
  }

  // Try charge_date_from/charge_date_to
  console.log('\nTesting charge_date_from/charge_date_to\n')

  const chargeBody = {
    charge_date_from: '2025-12-01',
    charge_date_to: '2025-12-04',
    page_size: 250
  }

  const chargeResponse = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(chargeBody)
  })

  if (chargeResponse.ok) {
    const chargeData = await chargeResponse.json()
    const dates = (chargeData.items || []).map(t => t.charge_date).filter(Boolean)
    console.log(`charge_date_from/to: ${chargeData.items?.length || 0} transactions`)
    console.log(`Actual dates: ${[...new Set(dates)].sort().join(', ')}`)
  }

  console.log('\n' + '═'.repeat(70))
  console.log('CONCLUSION')
  console.log('═'.repeat(70))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
