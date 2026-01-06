#!/usr/bin/env node
/**
 * Check what invoice ShipBob has for these 220 transactions
 * by querying the billing API with shipment IDs
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const token = process.env.SHIPBOB_API_TOKEN

  // Get the 220 NULL invoice transactions
  const { data: nullTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('NULL tx count:', nullTx?.length)

  // Query ShipBob billing API to find invoice for these shipments
  // We need to search by ReferenceId (shipment_id)
  console.log('\n=== Querying ShipBob for transaction invoice info ===\n')

  const sampleShipmentIds = (nullTx || []).slice(0, 10).map(t => t.reference_id)

  for (const shipId of sampleShipmentIds) {
    // Query transactions by reference_id (shipment)
    const url = `https://api.shipbob.com/2025-07/billing/transactions?ReferenceIds=${shipId}&PageSize=10`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })

    if (response.status === 200) {
      const data = await response.json()
      const items = data.items || data || []
      if (items.length > 0) {
        for (const tx of items) {
          console.log('  ', shipId, '→ invoice:', tx.invoice_id, 'type:', tx.invoice_type, 'date:', tx.invoice_date)
        }
      } else {
        console.log('  ', shipId, '→ NO TRANSACTIONS in ShipBob API!')
      }
    } else {
      console.log('  ', shipId, '→ API error:', response.status, await response.text())
    }
  }

  // Also check the total transaction count in ShipBob for this week
  console.log('\n=== Checking all transactions for Dec 15 ===\n')

  const url = `https://api.shipbob.com/2025-07/billing/transactions?StartDate=2025-12-15&EndDate=2025-12-15&PageSize=1000`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })

  if (response.status === 200) {
    const data = await response.json()
    const items = data.items || data || []
    console.log('Transactions for Dec 15:', items.length)
    console.log('Has next page:', !!data.next)

    // Check what invoices they're on
    const invoices = {}
    for (const tx of items) {
      const inv = tx.invoice_id || 'NULL'
      invoices[inv] = (invoices[inv] || 0) + 1
    }
    console.log('By invoice_id:')
    for (const [inv, c] of Object.entries(invoices).sort((a, b) => b[1] - a[1])) {
      console.log('  ', inv, ':', c)
    }
  } else {
    console.log('API error:', response.status)
  }
}

main().catch(console.error)
