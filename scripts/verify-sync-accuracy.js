#!/usr/bin/env node
/**
 * Verify Sync Accuracy: API vs Database
 * Run this AFTER a sync to confirm nothing was missed
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function verify() {
  console.log('=== SYNC VERIFICATION: API vs DATABASE ===')
  console.log(`Timestamp: ${new Date().toISOString()}\n`)

  // Get Henson's token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  if (!creds) {
    console.log('ERROR: Henson credentials not found')
    return
  }

  // Date range (7 days)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)
  const startStr = startDate.toISOString().split('T')[0]
  const endStr = endDate.toISOString().split('T')[0]

  console.log(`Date range: ${startStr} to ${endStr}\n`)

  // ============================================
  // STEP 1: Query API for current state
  // ============================================
  console.log('--- QUERYING API ---\n')

  // Fetch all orders from API
  let apiOrders = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({
      StartDate: startDate.toISOString(),
      EndDate: endDate.toISOString(),
      Limit: '250',
      Page: page.toString()
    })
    const response = await fetch(`https://api.shipbob.com/1.0/order?${params}`, {
      headers: { 'Authorization': `Bearer ${creds.api_token}` }
    })
    const orders = await response.json()
    if (orders.length === 0) break
    apiOrders.push(...orders)
    if (orders.length < 250) break
    page++
  }

  // Extract shipment IDs
  const apiShipmentIds = []
  for (const order of apiOrders) {
    if (order.shipments) {
      for (const s of order.shipments) {
        apiShipmentIds.push(s.id.toString())
      }
    }
  }

  // Fetch transactions for these shipments
  const apiTransactions = []
  for (let i = 0; i < apiShipmentIds.length; i += 100) {
    const batch = apiShipmentIds.slice(i, i + 100)
    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${parentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_ids: batch, page_size: 1000 })
    })
    const data = await response.json()
    apiTransactions.push(...(data.items || []))
  }

  // API summary
  const apiPending = apiTransactions.filter(t => !t.invoiced_status)
  const apiInvoiced = apiTransactions.filter(t => t.invoiced_status)

  const apiByFee = {}
  for (const tx of apiTransactions) {
    if (!apiByFee[tx.transaction_fee]) apiByFee[tx.transaction_fee] = { count: 0, amount: 0 }
    apiByFee[tx.transaction_fee].count++
    apiByFee[tx.transaction_fee].amount += tx.amount
  }

  console.log('API Results:')
  console.log(`  Orders: ${apiOrders.length}`)
  console.log(`  Shipments: ${apiShipmentIds.length}`)
  console.log(`  Transactions: ${apiTransactions.length}`)
  console.log(`    - Pending: ${apiPending.length} ($${apiPending.reduce((s,t) => s+t.amount, 0).toFixed(2)})`)
  console.log(`    - Invoiced: ${apiInvoiced.length} ($${apiInvoiced.reduce((s,t) => s+t.amount, 0).toFixed(2)})`)
  console.log(`  By fee type:`)
  Object.entries(apiByFee)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([fee, stats]) => {
      console.log(`    ${fee.padEnd(25)}: ${stats.count.toString().padStart(4)} tx, $${stats.amount.toFixed(2)}`)
    })

  // ============================================
  // STEP 2: Query DATABASE for current state
  // ============================================
  console.log('\n--- QUERYING DATABASE ---\n')

  // Count shipments in DB
  const { count: dbShipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .gte('order_date', startStr)

  // Get transactions from DB
  const { data: dbTransactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', HENSON_ID)
    .gte('charge_date', startStr)

  const dbTx = dbTransactions || []
  const dbPending = dbTx.filter(t => !t.invoiced_status)
  const dbInvoiced = dbTx.filter(t => t.invoiced_status)

  const dbByFee = {}
  for (const tx of dbTx) {
    const fee = tx.transaction_fee || tx.fee_type || 'Unknown'
    if (!dbByFee[fee]) dbByFee[fee] = { count: 0, amount: 0 }
    dbByFee[fee].count++
    dbByFee[fee].amount += parseFloat(tx.amount || tx.base_cost || 0)
  }

  console.log('Database Results:')
  console.log(`  Shipments: ${dbShipmentCount || 0}`)
  console.log(`  Transactions: ${dbTx.length}`)
  console.log(`    - Pending: ${dbPending.length}`)
  console.log(`    - Invoiced: ${dbInvoiced.length}`)
  console.log(`  By fee type:`)
  Object.entries(dbByFee)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([fee, stats]) => {
      console.log(`    ${fee.padEnd(25)}: ${stats.count.toString().padStart(4)} tx, $${stats.amount.toFixed(2)}`)
    })

  // ============================================
  // STEP 3: COMPARISON
  // ============================================
  console.log('\n========================================')
  console.log('VERIFICATION RESULTS')
  console.log('========================================\n')

  const checks = []

  // Shipment count
  const shipmentDiff = apiShipmentIds.length - (dbShipmentCount || 0)
  checks.push({
    name: 'Shipments',
    api: apiShipmentIds.length,
    db: dbShipmentCount || 0,
    diff: shipmentDiff,
    pass: shipmentDiff === 0
  })

  // Transaction count
  const txDiff = apiTransactions.length - dbTx.length
  checks.push({
    name: 'Transactions (total)',
    api: apiTransactions.length,
    db: dbTx.length,
    diff: txDiff,
    pass: txDiff === 0
  })

  // Pending count
  const pendingDiff = apiPending.length - dbPending.length
  checks.push({
    name: 'Pending transactions',
    api: apiPending.length,
    db: dbPending.length,
    diff: pendingDiff,
    pass: pendingDiff === 0
  })

  // By fee type
  const allFees = new Set([...Object.keys(apiByFee), ...Object.keys(dbByFee)])
  for (const fee of allFees) {
    const apiCount = apiByFee[fee]?.count || 0
    const dbCount = dbByFee[fee]?.count || 0
    const diff = apiCount - dbCount
    checks.push({
      name: `${fee}`,
      api: apiCount,
      db: dbCount,
      diff: diff,
      pass: diff === 0
    })
  }

  // Print results
  let allPass = true
  for (const check of checks) {
    const status = check.pass ? '✓' : '✗'
    const diffStr = check.diff === 0 ? '' : ` (${check.diff > 0 ? '+' : ''}${check.diff})`
    console.log(`${status} ${check.name.padEnd(30)}: API=${check.api.toString().padStart(5)}, DB=${check.db.toString().padStart(5)}${diffStr}`)
    if (!check.pass) allPass = false
  }

  console.log('\n========================================')
  if (allPass) {
    console.log('✓ ALL CHECKS PASSED - Sync is accurate!')
  } else {
    console.log('✗ DISCREPANCIES FOUND - Review above')
  }
  console.log('========================================')

  // If there are missing transactions, show which ones
  if (txDiff > 0) {
    console.log('\n--- MISSING TRANSACTIONS ---')
    const dbTxIds = new Set(dbTx.map(t => t.transaction_id))
    const missing = apiTransactions.filter(t => !dbTxIds.has(t.transaction_id))
    console.log(`Found ${missing.length} transactions in API but not in DB:`)
    missing.slice(0, 10).forEach(tx => {
      console.log(`  ${tx.transaction_id}: ${tx.transaction_fee} - $${tx.amount} (ref: ${tx.reference_id})`)
    })
    if (missing.length > 10) {
      console.log(`  ... and ${missing.length - 10} more`)
    }
  }
}

verify().catch(console.error)
