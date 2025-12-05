#!/usr/bin/env node
/**
 * Verify ALL transactions from invoice match our clients
 * (remove the 500 limit from previous script)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchWithAuth(endpoint) {
  const url = `${BASE_URL}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

async function getAllInvoiceTransactions(invoiceId) {
  const all = []
  let cursor = null
  do {
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`
    const data = await fetchWithAuth(endpoint)
    all.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)
  return all
}

async function main() {
  console.log('Verifying client coverage for Shipping invoice #8633612\n')

  // Get all transactions
  const transactions = await getAllInvoiceTransactions(8633612)
  console.log(`Total transactions: ${transactions.length}`)

  // Get all unique shipment refs
  const shipmentRefs = [...new Set(
    transactions
      .filter(tx => tx.reference_type === 'Shipment')
      .map(tx => parseInt(tx.reference_id))
  )]
  console.log(`Unique shipment refs: ${shipmentRefs.length}`)

  // Query ALL of them (no limit)
  console.log(`\nQuerying shipments table for all ${shipmentRefs.length} refs...`)

  const { data: matchedShipments, error } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, clients!inner(company_name)')
    .in('shipment_id', shipmentRefs)

  if (error) {
    console.error('Query error:', error)
    return
  }

  console.log(`Matched shipments: ${matchedShipments.length}`)

  // Calculate match rate - convert to strings for comparison
  const matchedSet = new Set(matchedShipments.map(s => String(s.shipment_id)))
  const unmatched = shipmentRefs.filter(id => !matchedSet.has(String(id)))

  console.log(`Unmatched shipment IDs: ${unmatched.length}`)

  if (unmatched.length > 0) {
    console.log(`\nFirst 20 unmatched IDs:`)
    unmatched.slice(0, 20).forEach(id => console.log(`  ${id}`))
  }

  // Client breakdown
  const byClient = {}
  for (const s of matchedShipments) {
    const name = s.clients?.company_name || 'Unknown'
    if (!byClient[name]) byClient[name] = { count: 0, shipments: new Set() }
    byClient[name].count++
    byClient[name].shipments.add(s.shipment_id)
  }

  console.log(`\nBreakdown by client:`)
  for (const [name, data] of Object.entries(byClient)) {
    console.log(`  ${name}: ${data.count} shipments`)
  }

  // Build lookup map for shipment -> client
  const shipmentToClient = new Map()
  for (const s of matchedShipments) {
    shipmentToClient.set(String(s.shipment_id), s.clients?.company_name || 'Unknown')
  }

  // Calculate amounts by client
  console.log(`\nAmount breakdown by client:`)
  const amountByClient = {}
  let unmatchedAmount = 0

  for (const tx of transactions) {
    if (tx.reference_type === 'Shipment') {
      const clientName = shipmentToClient.get(tx.reference_id)
      if (clientName) {
        if (!amountByClient[clientName]) amountByClient[clientName] = 0
        amountByClient[clientName] += tx.amount
      } else {
        unmatchedAmount += tx.amount
      }
    }
  }

  for (const [name, amount] of Object.entries(amountByClient).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: $${amount.toFixed(2)}`)
  }
  if (unmatchedAmount > 0) {
    console.log(`  UNMATCHED: $${unmatchedAmount.toFixed(2)}`)
  }

  // Summary
  console.log(`\n${'═'.repeat(50)}`)
  console.log('CONCLUSION')
  console.log(`${'═'.repeat(50)}`)

  const matchRate = (matchedShipments.length / shipmentRefs.length * 100)
  console.log(`\nMatch rate: ${matchRate.toFixed(1)}%`)

  if (matchRate > 99) {
    console.log(`\n✅ All API transactions belong to our clients!`)
    console.log(`   The ~52% "gap" is other Jetpack merchants we don't manage.`)
  } else {
    console.log(`\n⚠️ ${unmatched.length} shipments not in our database.`)
    console.log(`   These might be from other merchants, or recent shipments not yet synced.`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
