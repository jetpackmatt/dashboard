#!/usr/bin/env node
/**
 * Investigate WHY 220 shipping transactions have NULL invoice_id_sb
 * when they should be linked to invoice 8730385
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Get the 220 NULL invoice transactions
  console.log('=== NULL INVOICE SHIPPING TRANSACTIONS (Dec 15-21) ===\n')

  const { data: nullTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, invoice_id_sb, created_at, updated_at')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)
    .order('charge_date', { ascending: true })
    .limit(300)

  console.log('Total NULL invoice transactions:', nullTx?.length)

  // Check created_at distribution
  const createDates = {}
  for (const tx of nullTx || []) {
    const d = tx.created_at?.split('T')[0]
    createDates[d] = (createDates[d] || 0) + 1
  }
  console.log('\nBy created_at date:')
  for (const [d, c] of Object.entries(createDates).sort()) {
    console.log('  ', d, ':', c)
  }

  // Check updated_at distribution
  const updateDates = {}
  for (const tx of nullTx || []) {
    const d = tx.updated_at?.split('T')[0]
    updateDates[d] = (updateDates[d] || 0) + 1
  }
  console.log('\nBy updated_at date:')
  for (const [d, c] of Object.entries(updateDates).sort()) {
    console.log('  ', d, ':', c)
  }

  // Check charge_date distribution
  const chargeDates = {}
  for (const tx of nullTx || []) {
    const d = tx.charge_date?.split('T')[0]
    chargeDates[d] = (chargeDates[d] || 0) + 1
  }
  console.log('\nBy charge_date:')
  for (const [d, c] of Object.entries(chargeDates).sort()) {
    console.log('  ', d, ':', c)
  }

  // Sample the first 10
  console.log('\nSample transactions:')
  for (const tx of (nullTx || []).slice(0, 10)) {
    console.log('  tx:', tx.transaction_id, 'ref:', tx.reference_id, 'charge:', tx.charge_date?.split('T')[0], 'created:', tx.created_at)
  }

  // Check: are these shipments in the shipments table?
  console.log('\n=== CHECKING SHIPMENTS TABLE ===')
  const refIds = (nullTx || []).map(t => t.reference_id).filter(Boolean)

  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, event_labeled, shipped_date, client_id')
    .in('shipment_id', refIds.slice(0, 200))

  console.log('Shipments found:', shipments?.length, 'of', refIds.length)

  // Check if they're all Henson
  const shipmentClients = new Set((shipments || []).map(s => s.client_id))
  console.log('Shipment client_ids:', [...shipmentClients])

  // Check event_labeled dates for these shipments
  const labeledDates = {}
  for (const s of shipments || []) {
    const d = s.event_labeled?.split('T')[0]
    labeledDates[d] = (labeledDates[d] || 0) + 1
  }
  console.log('\nShipment event_labeled distribution:')
  for (const [d, c] of Object.entries(labeledDates).sort()) {
    console.log('  ', d, ':', c)
  }

  // Check: do the transactions with invoice_id_sb = 8730385 have similar charge_dates?
  console.log('\n=== COMPARING TO LINKED TRANSACTIONS ===')

  const { data: linkedTxDates } = await supabase
    .from('transactions')
    .select('charge_date')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)
    .is('dispute_status', null)
    .limit(3000)

  const linkedChargeDates = {}
  for (const tx of linkedTxDates || []) {
    const d = tx.charge_date?.split('T')[0]
    linkedChargeDates[d] = (linkedChargeDates[d] || 0) + 1
  }
  console.log('Linked transactions charge_dates:')
  for (const [d, c] of Object.entries(linkedChargeDates).sort()) {
    console.log('  ', d, ':', c)
  }

  // KEY QUESTION: Are these in ShipBob's invoice API response?
  // Check if these transaction_ids appear in the invoice in ShipBob's API
  console.log('\n=== CRITICAL: WHERE WERE THESE SYNCED FROM? ===')

  // Get the most recent transaction sync timestamps
  const { data: recentUpdates } = await supabase
    .from('transactions')
    .select('updated_at')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)
    .order('updated_at', { ascending: false })
    .limit(10)

  console.log('Most recent linked transaction updates:')
  for (const tx of recentUpdates || []) {
    console.log('  ', tx.updated_at)
  }

  // Check invoice 8730385 creation date
  const { data: invoice } = await supabase
    .from('invoices_sb')
    .select('*')
    .eq('shipbob_invoice_id', '8730385')
    .single()

  console.log('\nInvoice 8730385:')
  console.log('  invoice_date:', invoice?.invoice_date)
  console.log('  period_start:', invoice?.period_start)
  console.log('  period_end:', invoice?.period_end)
  console.log('  created_at:', invoice?.created_at)

  // Check: Can we call ShipBob API directly to see what transactions it returns for this invoice?
  console.log('\n=== CALLING SHIPBOB API ===')

  const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
  const sampleNullTxIds = (nullTx || []).slice(0, 5).map(t => t.transaction_id)

  console.log('Sample NULL invoice transaction IDs to look for:')
  for (const id of sampleNullTxIds) {
    console.log('  ', id)
  }

  // Fetch transactions from ShipBob for invoice 8730385
  try {
    const response = await fetch(`https://api.shipbob.com/2.0/invoices/8730385/transactions?pageSize=250`, {
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.log('ShipBob API error:', response.status, response.statusText)
    } else {
      const data = await response.json()
      console.log('\nShipBob API returned:', data.length || data.items?.length || 0, 'transactions for invoice 8730385')

      // Check if our sample IDs are in the response
      const apiTxIds = (data.items || data || []).map(t => t.transaction_id)
      console.log('API transaction IDs (first 10):', apiTxIds.slice(0, 10))

      // Are our NULL invoice tx IDs in the API response?
      const found = sampleNullTxIds.filter(id => apiTxIds.includes(id))
      console.log('Our NULL invoice tx IDs found in API response:', found.length, 'of', sampleNullTxIds.length)

      if (found.length === 0) {
        console.log('\n>>> CONCLUSION: These transactions are NOT in ShipBob\'s /invoices/8730385/transactions endpoint!')
        console.log('>>> They may need to be linked manually or via a different method.')
      }
    }
  } catch (e) {
    console.log('API call failed:', e.message)
  }

  // Final analysis: Check when sync-invoices last ran
  console.log('\n=== SYNC ANALYSIS ===')

  // Count transactions by invoice_id_sb to see the pattern
  const { data: allTxByInvoice } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)
    .limit(3000)

  const byInvoice = {}
  for (const tx of allTxByInvoice || []) {
    const inv = tx.invoice_id_sb || 'NULL'
    byInvoice[inv] = (byInvoice[inv] || 0) + 1
  }
  console.log('All Henson shipping tx (Dec 15-21) by invoice_id_sb:')
  for (const [inv, c] of Object.entries(byInvoice)) {
    console.log('  ', inv, ':', c)
  }

  // The expected total for Dec 15-21 should be 2327 (shipments)
  // We have: 2107 + 220 = 2327 - that adds up!
  const total = Object.values(byInvoice).reduce((s, c) => s + c, 0)
  console.log('\nTotal:', total)
  console.log('Expected (shipments):', 2327)
  console.log('Difference:', 2327 - total)
}

main().catch(console.error)
