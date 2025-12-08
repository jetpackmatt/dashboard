/**
 * Fix shipping transaction attribution by looking up shipment owner
 * For Shipment-type transactions, use the reference_id (shipment_id) to find the correct owner
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('FIX SHIPPING TRANSACTION ATTRIBUTION')
  console.log('='.repeat(70))

  // Build shipment_id -> client_id lookup from shipments table
  console.log('\nBuilding shipment->client lookup...')
  const shipmentToClient = {}
  let cursor = 0

  while (true) {
    const { data, error } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .range(cursor, cursor + 999)
      .order('id')

    if (error) {
      console.log('Error:', error)
      break
    }
    if (!data || data.length === 0) break

    for (const s of data) {
      if (s.shipment_id && s.client_id) {
        shipmentToClient[s.shipment_id] = s.client_id
      }
    }
    cursor += data.length
    if (data.length < 1000) break
  }
  console.log(`Shipments in lookup: ${Object.keys(shipmentToClient).length}`)

  // Get client info
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')

  const clientLookup = {}
  for (const c of clients || []) {
    clientLookup[c.id] = c
  }

  // Find Shipment-type transactions with mismatched client
  console.log('\nLooking for Shipment transactions with wrong client attribution...')

  // Get all Shipment-type transactions for invoice 8633612 (shipping invoice)
  const invoiceId = 8633612
  let allTx = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, transaction_id, reference_id, reference_type, client_id, amount, transaction_fee')
      .eq('invoice_id_sb', invoiceId)
      .eq('reference_type', 'Shipment')
      .range(offset, offset + 999)

    if (error) {
      console.log('Error:', error)
      break
    }
    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  console.log(`Total Shipment transactions in invoice: ${allTx.length}`)

  // Check each transaction
  const mismatches = []
  const stats = { correct: 0, wrong: 0, noShipment: 0 }

  for (const tx of allTx) {
    const shipmentId = tx.reference_id
    const correctClientId = shipmentToClient[shipmentId]

    if (!correctClientId) {
      stats.noShipment++
      continue
    }

    if (tx.client_id === correctClientId) {
      stats.correct++
    } else {
      stats.wrong++
      mismatches.push({
        transactionId: tx.transaction_id,
        id: tx.id,
        shipmentId,
        currentClient: clientLookup[tx.client_id]?.company_name || tx.client_id,
        correctClient: clientLookup[correctClientId]?.company_name || correctClientId,
        correctClientId,
        amount: tx.amount,
        fee: tx.transaction_fee
      })
    }
  }

  console.log(`\nAttribution stats:`)
  console.log(`  Correct: ${stats.correct}`)
  console.log(`  Wrong: ${stats.wrong}`)
  console.log(`  No shipment found: ${stats.noShipment}`)

  if (mismatches.length > 0) {
    // Show samples
    console.log(`\nSample mismatches (first 10):`)
    for (const m of mismatches.slice(0, 10)) {
      console.log(`  Tx ${m.transactionId}: $${Number(m.amount).toFixed(2)} (${m.fee})`)
      console.log(`    Currently: ${m.currentClient}`)
      console.log(`    Should be: ${m.correctClient}`)
    }

    // Calculate total misattributed
    const hensonId = clients.find(c => c.company_name.toLowerCase().includes('henson'))?.id
    const wronglyTakenFromHenson = mismatches.filter(m => m.correctClientId === hensonId)
    const totalWrongFromHenson = wronglyTakenFromHenson.reduce((s, m) => s + Number(m.amount), 0)

    console.log(`\n${'='.repeat(70)}`)
    console.log(`IMPACT:`)
    console.log(`${'='.repeat(70)}`)
    console.log(`  Transactions wrongly taken FROM Henson: ${wronglyTakenFromHenson.length}`)
    console.log(`  Total amount wrongly attributed: $${totalWrongFromHenson.toFixed(2)}`)

    // Ask for confirmation to fix
    console.log(`\nTo fix these ${mismatches.length} transactions, run with --fix flag`)

    if (process.argv.includes('--fix')) {
      console.log('\nApplying fixes...')
      let fixed = 0
      for (const m of mismatches) {
        const correctMerchantId = clientLookup[m.correctClientId]?.merchant_id
        await supabase
          .from('transactions')
          .update({
            client_id: m.correctClientId,
            merchant_id: correctMerchantId
          })
          .eq('id', m.id)
        fixed++
        if (fixed % 100 === 0) process.stdout.write(`\rFixed ${fixed}/${mismatches.length}...`)
      }
      console.log(`\nFixed ${fixed} transactions!`)
    }
  }
}

main().catch(console.error)
