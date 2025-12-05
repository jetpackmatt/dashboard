/**
 * Sync ALL historical transactions from ShipBob API
 *
 * This script fetches ALL transactions (not just shipment-linked) using date ranges.
 * Use this for initial backfill and periodic full reconciliation.
 *
 * Usage:
 *   node scripts/sync-all-transactions.js                    # Last 7 days
 *   node scripts/sync-all-transactions.js --days 30          # Last 30 days
 *   node scripts/sync-all-transactions.js --from 2024-01-01  # From specific date
 *   node scripts/sync-all-transactions.js --full             # All available history
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const BATCH_SIZE = 500

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Parse command line args
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    days: 7,
    from: null,
    full: false,
    dryRun: false
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      options.days = parseInt(args[i + 1])
      i++
    } else if (args[i] === '--from' && args[i + 1]) {
      options.from = args[i + 1]
      i++
    } else if (args[i] === '--full') {
      options.full = true
    } else if (args[i] === '--dry-run') {
      options.dryRun = true
    }
  }

  return options
}

// Fetch all transactions for a date range
async function fetchTransactions(startDate, endDate, token) {
  const transactions = []
  let cursor = null
  let page = 0

  do {
    page++
    let url = `${SHIPBOB_API_BASE}/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: startDate.toISOString(),
        to_date: endDate.toISOString(),
        page_size: 1000
      })
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    transactions.push(...(data.items || []))
    cursor = data.next

    process.stdout.write(`\r  Page ${page} (${transactions.length} transactions)...`)
  } while (cursor)

  console.log() // newline
  return transactions
}

// Build client lookup from shipments table
async function buildClientLookup() {
  console.log('Building client lookup from shipments...')

  const lookup = {}
  let lastId = null
  const pageSize = 1000
  let totalFetched = 0

  // Use cursor-based pagination with order by id
  while (true) {
    let query = supabase
      .from('shipments')
      .select('id, shipment_id, client_id')
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching shipments:', error.message)
      break
    }

    if (!data || data.length === 0) break

    for (const s of data) {
      lookup[s.shipment_id] = s.client_id
      lastId = s.id
    }

    totalFetched += data.length
    process.stdout.write(`\r  Fetched ${totalFetched} shipments...`)

    if (data.length < pageSize) break
  }

  console.log(`\n  Built lookup with ${Object.keys(lookup).length} shipments`)
  return lookup
}

// Upsert transactions to database
async function upsertTransactions(transactions, clientLookup, dryRun = false) {
  if (transactions.length === 0) return { inserted: 0, updated: 0, errors: [] }

  const errors = []
  let processed = 0

  // Transform to DB records
  const records = transactions.map(tx => {
    // Try to attribute client from shipment lookup
    let clientId = null
    if (tx.reference_type === 'Shipment' || tx.reference_type === 'Default') {
      clientId = clientLookup[tx.reference_id] || null
    }

    return {
      transaction_id: tx.transaction_id,
      client_id: clientId,
      reference_id: tx.reference_id,
      reference_type: tx.reference_type,
      transaction_fee: tx.transaction_fee,
      amount: tx.amount,
      charge_date: tx.charge_date,
      // Use the new _sb column names (after migration)
      invoiced_status_sb: tx.invoiced_status || false,
      invoice_id_sb: tx.invoice_id || null,
      fulfillment_center: tx.fulfillment_center || null,
      additional_details: tx.additional_details || null,
      updated_at: new Date().toISOString()
    }
  })

  if (dryRun) {
    console.log(`  [DRY RUN] Would upsert ${records.length} records`)
    return { inserted: records.length, updated: 0, errors: [] }
  }

  // Batch upsert
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    const { error } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'transaction_id', ignoreDuplicates: false })

    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
    } else {
      processed += batch.length
    }

    process.stdout.write(`\r  Upserting: ${processed}/${records.length}...`)
  }

  console.log() // newline
  return { inserted: processed, updated: 0, errors }
}

// Main sync function
async function syncAllTransactions() {
  const options = parseArgs()
  const token = process.env.SHIPBOB_API_TOKEN

  if (!token) {
    console.error('ERROR: SHIPBOB_API_TOKEN not set')
    process.exit(1)
  }

  console.log('='.repeat(60))
  console.log('Sync All Transactions')
  console.log('='.repeat(60))

  // Calculate date range
  let startDate, endDate
  endDate = new Date()

  if (options.full) {
    // Start from Jan 2024 (or whenever ShipBob data began)
    startDate = new Date('2024-01-01')
    console.log(`Mode: Full historical sync from ${startDate.toISOString().split('T')[0]}`)
  } else if (options.from) {
    startDate = new Date(options.from)
    console.log(`Mode: From ${options.from} to now`)
  } else {
    startDate = new Date()
    startDate.setDate(startDate.getDate() - options.days)
    console.log(`Mode: Last ${options.days} days`)
  }

  if (options.dryRun) {
    console.log('DRY RUN - no changes will be made')
  }

  console.log(`\nDate range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)

  // Build client lookup
  const clientLookup = await buildClientLookup()

  // Fetch transactions in chunks (monthly) to avoid timeouts
  const allTransactions = []
  let chunkStart = new Date(startDate)

  while (chunkStart < endDate) {
    const chunkEnd = new Date(chunkStart)
    chunkEnd.setMonth(chunkEnd.getMonth() + 1)
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime())

    console.log(`\nFetching ${chunkStart.toISOString().split('T')[0]} to ${chunkEnd.toISOString().split('T')[0]}...`)

    try {
      const transactions = await fetchTransactions(chunkStart, chunkEnd, token)
      allTransactions.push(...transactions)
    } catch (error) {
      console.error(`  Error: ${error.message}`)
    }

    chunkStart = new Date(chunkEnd)
  }

  console.log(`\nTotal transactions fetched: ${allTransactions.length}`)

  // Analyze reference types
  const refTypes = {}
  const feeTypes = {}
  for (const tx of allTransactions) {
    refTypes[tx.reference_type] = (refTypes[tx.reference_type] || 0) + 1
    feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
  }

  console.log('\nReference types:')
  for (const [type, count] of Object.entries(refTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nTop 10 fee types:')
  const sortedFees = Object.entries(feeTypes).sort((a, b) => b[1] - a[1]).slice(0, 10)
  for (const [type, count] of sortedFees) {
    console.log(`  ${type}: ${count}`)
  }

  // Check attribution coverage
  let attributed = 0
  let unattributed = 0
  for (const tx of allTransactions) {
    if (tx.reference_type === 'Shipment' || tx.reference_type === 'Default') {
      if (clientLookup[tx.reference_id]) {
        attributed++
      } else {
        unattributed++
      }
    }
  }
  console.log(`\nClient attribution for Shipment/Default:`)
  console.log(`  Attributed: ${attributed} (${(attributed / (attributed + unattributed) * 100).toFixed(1)}%)`)
  console.log(`  Unattributed: ${unattributed}`)

  // Upsert to database
  console.log('\nUpserting to database...')
  const result = await upsertTransactions(allTransactions, clientLookup, options.dryRun)

  console.log(`\nDone!`)
  console.log(`  Processed: ${result.inserted}`)
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`)
    result.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`))
  }
}

syncAllTransactions().catch(console.error)
