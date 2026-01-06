#!/usr/bin/env node
/**
 * Check what invoice ShipBob assigns to our 220 "linked" transactions
 * by querying the transactions:query API directly
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const token = process.env.SHIPBOB_API_TOKEN
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Get sample of the 220 transactions we linked
  const { data: linkedTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)
    .gte('updated_at', '2025-12-22T20:00:00Z')
    .limit(20)

  console.log('Sample of our 220 linked transactions:')
  for (const tx of (linkedTx || []).slice(0, 5)) {
    console.log('  tx:', tx.transaction_id, 'ref:', tx.reference_id)
  }

  // Query ShipBob's transactions:query API with these reference_ids
  console.log('\n=== Querying ShipBob transactions:query API ===\n')

  const refIds = (linkedTx || []).map(t => t.reference_id)

  const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: refIds,
      page_size: 100
    })
  })

  console.log('API Status:', response.status)

  if (response.status === 200) {
    const data = await response.json()
    const items = data.items || data || []
    console.log('Transactions returned:', items.length)

    // Show what invoice ShipBob assigns
    console.log('\nShipBob invoice assignments:')
    for (const tx of items.slice(0, 20)) {
      console.log('  ref:', tx.reference_id, '→ invoice:', tx.invoice_id || 'NULL', 'date:', tx.invoice_date || 'NULL', 'invoiced:', tx.invoiced_status)
    }

    // Group by invoice_id
    const byInvoice = {}
    for (const tx of items) {
      const inv = tx.invoice_id || 'NULL'
      byInvoice[inv] = (byInvoice[inv] || 0) + 1
    }
    console.log('\nBy invoice_id:')
    for (const [inv, c] of Object.entries(byInvoice)) {
      console.log('  ', inv, ':', c)
    }

    if (byInvoice['NULL'] > 0 || byInvoice['null'] > 0) {
      console.log('\n>>> CONCLUSION: ShipBob has NOT assigned an invoice to these transactions!')
      console.log('>>> invoiced_status=false means they are NOT yet billed by ShipBob.')
      console.log('>>> We should NOT be linking them to invoice 8730385.')
    } else if (byInvoice['8730385']) {
      console.log('\n>>> ShipBob says these belong to invoice 8730385!')
      console.log('>>> But /invoices/8730385/transactions does NOT return them - API bug?')
    } else {
      console.log('\n>>> ShipBob assigns these to a DIFFERENT invoice!')
    }
  } else {
    console.log('Error:', await response.text())
  }
}

main().catch(console.error)
