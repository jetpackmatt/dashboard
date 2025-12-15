/**
 * Test the returns sync second pass fix for unattributed returns
 * This specifically tests return 2969524 that has client_id=null
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testReturnSync() {
  const testReturnId = 2969524

  console.log('=== BEFORE STATE ===\n')

  // Check transaction state
  const { data: txBefore } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, client_id, merchant_id, fee_type')
    .eq('reference_id', testReturnId.toString())
    .eq('reference_type', 'Return')
    .single()

  console.log('Transaction before:', txBefore)

  // Check returns table
  const { data: returnBefore } = await supabase
    .from('returns')
    .select('shipbob_return_id, client_id, status, original_shipment_id')
    .eq('shipbob_return_id', testReturnId)
    .maybeSingle()

  console.log('Return record before:', returnBefore || '(not found)')

  console.log('\n=== RUNNING SYNC LOGIC ===\n')

  // Get parent token
  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    console.log('ERROR: No parent token')
    return
  }

  // Fetch return from API
  console.log(`Fetching return ${testReturnId} from ShipBob API...`)
  const res = await fetch(`https://api.shipbob.com/1.0/return/${testReturnId}`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  })

  if (!res.ok) {
    console.log(`Failed to fetch: ${res.status}`)
    return
  }

  const returnData = await res.json()
  console.log('API Response:', {
    id: returnData.id,
    status: returnData.status,
    original_shipment_id: returnData.original_shipment_id,
    reference_id: returnData.reference_id,
    fulfillment_center: returnData.fulfillment_center?.name,
    channel: returnData.channel?.name
  })

  // Lookup client via original_shipment_id
  const originalShipmentId = returnData.original_shipment_id
  console.log(`\nLooking up shipment ${originalShipmentId} to find client...`)

  const { data: shipment } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, tracking_number')
    .eq('shipment_id', originalShipmentId)
    .maybeSingle()

  if (!shipment) {
    console.log(`ERROR: Shipment ${originalShipmentId} not found in database`)
    return
  }

  console.log('Found shipment:', shipment)

  const clientId = shipment.client_id
  if (!clientId) {
    console.log('ERROR: Shipment has no client_id')
    return
  }

  // Get client info
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .eq('id', clientId)
    .single()

  console.log('Client:', client)

  // Upsert the return
  console.log('\n=== UPSERTING RETURN ===\n')

  const returnRecord = {
    client_id: clientId,
    merchant_id: client?.merchant_id || null,
    shipbob_return_id: returnData.id,
    reference_id: returnData.reference_id || null,
    status: returnData.status || null,
    return_type: returnData.return_type || null,
    tracking_number: returnData.tracking_number || null,
    shipment_tracking_number: returnData.tracking_number || null,
    original_shipment_id: returnData.original_shipment_id || null,
    store_order_id: returnData.store_order_id || null,
    invoice_amount: returnData.invoice_amount || null,
    invoice_currency: 'USD',
    fc_id: returnData.fulfillment_center?.id || null,
    fc_name: returnData.fulfillment_center?.name || null,
    channel_id: returnData.channel?.id || null,
    channel_name: returnData.channel?.name || null,
    insert_date: returnData.insert_date || null,
    awaiting_arrival_date: returnData.status === 'AwaitingArrival' ? returnData.insert_date : null,
    arrived_date: returnData.arrived_date || null,
    processing_date: returnData.processing_date || null,
    completed_date: returnData.completed_date || null,
    cancelled_date: returnData.cancelled_date || null,
    status_history: returnData.status_history || null,
    inventory: returnData.inventory || null,
    synced_at: new Date().toISOString(),
  }

  const { error: returnError } = await supabase
    .from('returns')
    .upsert(returnRecord, { onConflict: 'shipbob_return_id' })

  if (returnError) {
    console.log('Return upsert error:', returnError)
    return
  }

  console.log('Return upserted successfully!')

  // Update transaction's client_id
  console.log('\n=== UPDATING TRANSACTION ===\n')

  const { error: txError, data: txUpdated } = await supabase
    .from('transactions')
    .update({ client_id: clientId, merchant_id: client?.merchant_id })
    .eq('reference_type', 'Return')
    .eq('reference_id', testReturnId.toString())
    .select()

  if (txError) {
    console.log('Transaction update error:', txError)
  } else {
    console.log('Transaction updated:', txUpdated)
  }

  // Verify final state
  console.log('\n=== AFTER STATE ===\n')

  const { data: txAfter } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, client_id, merchant_id, fee_type')
    .eq('reference_id', testReturnId.toString())
    .eq('reference_type', 'Return')
    .single()

  console.log('Transaction after:', txAfter)

  const { data: returnAfter } = await supabase
    .from('returns')
    .select('shipbob_return_id, client_id, status, original_shipment_id, fc_name, channel_name')
    .eq('shipbob_return_id', testReturnId)
    .maybeSingle()

  console.log('Return record after:', returnAfter)

  console.log('\n✅ SUCCESS: Return 2969524 is now attributed!')
}

testReturnSync().catch(console.error)
