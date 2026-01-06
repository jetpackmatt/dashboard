#!/usr/bin/env node
/**
 * Check if the 220 NULL transactions are for cancelled/voided shipments
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
    .select('transaction_id, reference_id, cost')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('=== Checking if these are cancelled shipments ===\n')
  console.log('NULL tx count:', nullTx?.length)

  // Sum the costs of these transactions
  const totalCost = (nullTx || []).reduce((s, t) => s + parseFloat(t.cost), 0)
  console.log('Total cost of NULL tx:', totalCost.toFixed(2))

  // Check a sample via child token (Henson's token) to see shipment status
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', hensonId)
    .single()

  if (!creds?.api_token) {
    console.log('No Henson token found')
    return
  }
  const hensonToken = creds.api_token

  console.log('\n=== Checking shipment status via Henson token ===')

  const sampleShipmentIds = (nullTx || []).slice(0, 10).map(t => t.reference_id)

  for (const shipId of sampleShipmentIds) {
    const url = `https://api.shipbob.com/1.0/shipment/${shipId}`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${hensonToken}`,
        'Accept': 'application/json'
      }
    })

    if (response.status === 200) {
      const data = await response.json()
      console.log('  ', shipId, '→ status:', data.status, 'tracking:', data.tracking?.tracking_number)
    } else if (response.status === 404) {
      console.log('  ', shipId, '→ NOT FOUND (404)')
    } else {
      console.log('  ', shipId, '→ error:', response.status)
    }
  }

  // Also check if there are REFUND transactions for these shipments
  console.log('\n=== Checking for refund transactions ===')

  const refIds = (nullTx || []).map(t => t.reference_id)
  const { data: refunds } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, cost, transaction_type')
    .in('reference_id', refIds)
    .eq('transaction_type', 'Refund')

  console.log('Refund transactions found:', refunds?.length || 0)

  if (refunds && refunds.length > 0) {
    const refundTotal = refunds.reduce((s, t) => s + parseFloat(t.cost), 0)
    console.log('Total refund amount:', refundTotal.toFixed(2))
  }

  // Final theory
  console.log('\n=== FINAL ANALYSIS ===')
  console.log('If shipments return 404, they were likely CANCELLED.')
  console.log('ShipBob would have created a refund transaction and removed')
  console.log('the original charge from the invoice.')
  console.log('')
  console.log('These 220 transactions ($' + totalCost.toFixed(2) + ') should probably')
  console.log('be marked as cancelled/disputed in our system since ShipBob')
  console.log('is not billing for them.')
}

main().catch(console.error)
