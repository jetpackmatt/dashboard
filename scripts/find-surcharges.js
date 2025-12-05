#!/usr/bin/env node
/**
 * Deep dive to find surcharges - they MUST be somewhere
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...params, page_size: 1000 })
    })

    if (!response.ok) return []

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null

    if (pageNum >= 50) break
  } while (cursor)

  return allItems
}

function deepSearch(obj, searchTerms, path = '') {
  const results = []

  if (obj === null || obj === undefined) return results

  if (typeof obj === 'string') {
    for (const term of searchTerms) {
      if (obj.toLowerCase().includes(term.toLowerCase())) {
        results.push({ path, value: obj, matchedTerm: term })
      }
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      results.push(...deepSearch(item, searchTerms, `${path}[${i}]`))
    })
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      // Check key name too
      for (const term of searchTerms) {
        if (key.toLowerCase().includes(term.toLowerCase())) {
          results.push({ path: `${path}.${key}`, value, matchedTerm: term, keyMatch: true })
        }
      }
      results.push(...deepSearch(value, searchTerms, `${path}.${key}`))
    }
  }

  return results
}

async function main() {
  console.log('═'.repeat(80))
  console.log('DEEP SURCHARGE SEARCH')
  console.log('═'.repeat(80))

  // Get a large sample of transactions
  console.log('\nFetching transactions (last 60 days, all types)...')
  const allTxs = await queryTransactions({
    from_date: '2025-10-01T00:00:00Z',
    to_date: '2025-12-05T23:59:59Z'
  })
  console.log(`Total transactions: ${allTxs.length}`)

  // Search terms
  const searchTerms = [
    'surcharge', 'sur charge',
    'DIM', 'dimensional',
    'residential',
    'delivery area', 'DAS',
    'peak', 'fuel',
    'oversize', 'over size',
    'additional handling',
    'remote', 'extended'
  ]

  console.log(`\nSearching for: ${searchTerms.join(', ')}`)
  console.log('─'.repeat(80))

  // Search ALL transactions deeply
  const allMatches = []
  for (const tx of allTxs) {
    const matches = deepSearch(tx, searchTerms)
    if (matches.length > 0) {
      allMatches.push({ tx, matches })
    }
  }

  console.log(`\nTransactions with surcharge-related content: ${allMatches.length}`)

  // Group by match type
  const byMatchTerm = {}
  for (const { tx, matches } of allMatches) {
    for (const match of matches) {
      if (!byMatchTerm[match.matchedTerm]) {
        byMatchTerm[match.matchedTerm] = []
      }
      byMatchTerm[match.matchedTerm].push({ tx, match })
    }
  }

  for (const [term, items] of Object.entries(byMatchTerm)) {
    console.log(`\n${'█'.repeat(60)}`)
    console.log(`TERM: "${term}" - ${items.length} matches`)
    console.log('█'.repeat(60))

    // Show unique paths
    const uniquePaths = [...new Set(items.map(i => i.match.path))]
    console.log(`\nFound in paths:`)
    for (const path of uniquePaths) {
      console.log(`  ${path}`)
    }

    // Show samples
    console.log(`\nSample transactions:`)
    const shown = new Set()
    for (const { tx, match } of items.slice(0, 5)) {
      if (shown.has(tx.transaction_id)) continue
      shown.add(tx.transaction_id)

      console.log(`\n--- Transaction ${tx.transaction_id} ---`)
      console.log(`  transaction_fee: ${tx.transaction_fee}`)
      console.log(`  amount: $${tx.amount}`)
      console.log(`  reference_id: ${tx.reference_id}`)
      console.log(`  Match path: ${match.path}`)
      console.log(`  Match value: ${JSON.stringify(match.value).slice(0, 200)}`)

      if (tx.additional_details) {
        console.log(`  additional_details: ${JSON.stringify(tx.additional_details)}`)
      }
    }
  }

  // Also check: what transaction_fee values contain surcharge keywords?
  console.log('\n' + '═'.repeat(80))
  console.log('TRANSACTION_FEE VALUES CONTAINING SURCHARGE KEYWORDS')
  console.log('═'.repeat(80))

  const feeTypesWithSurcharge = {}
  for (const tx of allTxs) {
    const fee = tx.transaction_fee || ''
    for (const term of searchTerms) {
      if (fee.toLowerCase().includes(term.toLowerCase())) {
        if (!feeTypesWithSurcharge[fee]) {
          feeTypesWithSurcharge[fee] = { count: 0, total: 0, samples: [] }
        }
        feeTypesWithSurcharge[fee].count++
        feeTypesWithSurcharge[fee].total += tx.amount
        if (feeTypesWithSurcharge[fee].samples.length < 2) {
          feeTypesWithSurcharge[fee].samples.push(tx)
        }
        break
      }
    }
  }

  if (Object.keys(feeTypesWithSurcharge).length > 0) {
    for (const [fee, data] of Object.entries(feeTypesWithSurcharge)) {
      console.log(`\n${fee}: ${data.count} transactions, $${data.total.toFixed(2)} total`)
      console.log('Sample:')
      console.log(JSON.stringify(data.samples[0], null, 2))
    }
  } else {
    console.log('\nNo transaction_fee values match surcharge keywords!')
  }

  // Check the Comment field specifically
  console.log('\n' + '═'.repeat(80))
  console.log('COMMENT FIELD ANALYSIS')
  console.log('═'.repeat(80))

  const commentsWithSurcharge = []
  for (const tx of allTxs) {
    const comment = tx.additional_details?.Comment || ''
    for (const term of searchTerms) {
      if (comment.toLowerCase().includes(term.toLowerCase())) {
        commentsWithSurcharge.push({ tx, comment, term })
        break
      }
    }
  }

  console.log(`\nComments mentioning surcharge keywords: ${commentsWithSurcharge.length}`)
  for (const { tx, comment, term } of commentsWithSurcharge.slice(0, 10)) {
    console.log(`\n  Term: "${term}"`)
    console.log(`  Fee: ${tx.transaction_fee}`)
    console.log(`  Amount: $${tx.amount}`)
    console.log(`  Comment: "${comment}"`)
  }

  // Finally: look at the SHIPPING transactions and see if there's ANY pattern
  console.log('\n' + '═'.repeat(80))
  console.log('SHIPPING TRANSACTIONS - LOOKING FOR HIDDEN BREAKDOWN')
  console.log('═'.repeat(80))

  const shippingTxs = allTxs.filter(t => t.transaction_fee === 'Shipping')
  console.log(`\nTotal Shipping transactions: ${shippingTxs.length}`)

  // Check ALL keys in shipping transactions
  const allShippingKeys = new Set()
  for (const tx of shippingTxs) {
    const getAllKeys = (obj, prefix = '') => {
      if (!obj || typeof obj !== 'object') return
      for (const [k, v] of Object.entries(obj)) {
        allShippingKeys.add(prefix + k)
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          getAllKeys(v, prefix + k + '.')
        }
      }
    }
    getAllKeys(tx)
  }

  console.log(`\nAll keys found in Shipping transactions:`)
  for (const key of [...allShippingKeys].sort()) {
    console.log(`  ${key}`)
  }

  // Show a few shipping transaction samples with ALL data
  console.log('\nFull shipping transaction samples:')
  for (const tx of shippingTxs.slice(0, 3)) {
    console.log(JSON.stringify(tx, null, 2))
    console.log('---')
  }

  // Check if there's variance in shipping amounts that might indicate hidden surcharges
  const shippingAmounts = shippingTxs.map(t => t.amount)
  const min = Math.min(...shippingAmounts)
  const max = Math.max(...shippingAmounts)
  const avg = shippingAmounts.reduce((a, b) => a + b, 0) / shippingAmounts.length

  console.log(`\nShipping amount statistics:`)
  console.log(`  Min: $${min.toFixed(2)}`)
  console.log(`  Max: $${max.toFixed(2)}`)
  console.log(`  Avg: $${avg.toFixed(2)}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
