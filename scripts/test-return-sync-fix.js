/**
 * Test the updated second pass that tries each client token
 * This simulates what syncReturns would do for return 2969524
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function test() {
  const returnId = 2969524

  console.log(`=== TESTING CLIENT TOKEN LOOKUP FOR RETURN ${returnId} ===\n`)

  // Get all clients with their tokens (mimicking clientLookup in syncReturns)
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  const clientLookup = {}
  for (const c of clients || []) {
    const creds = c.client_api_credentials
    const token = creds?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientLookup[c.id] = { token, merchantId: c.merchant_id, name: c.company_name }
    }
  }

  console.log(`Found ${Object.keys(clientLookup).length} clients with tokens:\n`)
  for (const [id, info] of Object.entries(clientLookup)) {
    console.log(`  ${info.name}`)
  }

  console.log(`\n=== TRYING EACH CLIENT TOKEN FOR RETURN ${returnId} ===\n`)

  let foundClient = null
  let returnData = null

  for (const [clientId, clientInfo] of Object.entries(clientLookup)) {
    try {
      const res = await fetch(`https://api.shipbob.com/1.0/return/${returnId}`, {
        headers: { Authorization: `Bearer ${clientInfo.token}` }
      })

      if (res.ok) {
        returnData = await res.json()
        foundClient = { clientId, ...clientInfo }
        console.log(`✅ ${clientInfo.name}: FOUND!`)
        console.log(`   Status: ${returnData.status}`)
        console.log(`   Original Shipment: ${returnData.original_shipment_id}`)
        console.log(`   FC: ${returnData.fulfillment_center?.name}`)
        console.log(`   Channel: ${returnData.channel?.name}`)
        break
      } else {
        console.log(`❌ ${clientInfo.name}: ${res.status}`)
      }
    } catch (e) {
      console.log(`❌ ${clientInfo.name}: Error - ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 100))
  }

  if (!foundClient) {
    console.log('\n❌ NO CLIENT TOKEN COULD FIND THIS RETURN')
    console.log('\n   This means the return belongs to a merchant that is NOT')
    console.log('   one of our active Jetpack clients. The transaction will')
    console.log('   remain unattributed.')
    return
  }

  console.log(`\n✅ FOUND: Return belongs to ${foundClient.name}`)
  console.log('\n   When the sync runs, it will:')
  console.log('   1. Upsert the return to returns table')
  console.log('   2. Update the transaction client_id')
  console.log('   3. The return will appear in the Returns tab!')

  // Optionally, actually do the upsert
  console.log('\n=== PERFORMING UPSERT (DRY RUN DISABLED) ===\n')

  const { error: returnError } = await supabase
    .from('returns')
    .upsert({
      client_id: foundClient.clientId,
      merchant_id: foundClient.merchantId,
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
    }, { onConflict: 'shipbob_return_id' })

  if (returnError) {
    console.log('Upsert error:', returnError.message)
    return
  }

  console.log('✅ Return upserted to returns table')

  // Update transaction
  const { error: txError } = await supabase
    .from('transactions')
    .update({ client_id: foundClient.clientId, merchant_id: foundClient.merchantId })
    .eq('reference_type', 'Return')
    .eq('reference_id', returnId.toString())

  if (txError) {
    console.log('Transaction update error:', txError.message)
    return
  }

  console.log('✅ Transaction client_id updated')

  // Verify
  console.log('\n=== VERIFICATION ===\n')

  const { data: verifyReturn } = await supabase
    .from('returns')
    .select('shipbob_return_id, client_id, status, fc_name')
    .eq('shipbob_return_id', returnId)
    .single()

  console.log('Returns table:', verifyReturn)

  const { data: verifyTx } = await supabase
    .from('transactions')
    .select('reference_id, client_id')
    .eq('reference_id', returnId.toString())
    .eq('reference_type', 'Return')
    .single()

  console.log('Transaction:', verifyTx)

  console.log('\n✅ DONE! Return 2969524 is now attributed.')
}

test().catch(console.error)
