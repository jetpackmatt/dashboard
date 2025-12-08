#!/usr/bin/env node
/**
 * Test preflight validation for Dec 1 invoice period (JPHS-0037)
 * Uses specific ShipBob invoice IDs from the reference invoice
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Dec 1 invoice IDs from JPHS-0037 reference
const DEC1_INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

// Client IDs
const CLIENTS = {
  HENSON: '6b94c274-0446-4167-9d02-b998f8be59ad',
  METHYL_LIFE: 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e',
}

async function runPreflightTest() {
  console.log('='.repeat(70))
  console.log('PREFLIGHT VALIDATION TEST - Dec 1 Invoice Period')
  console.log('='.repeat(70))
  console.log(`ShipBob Invoice IDs: ${DEC1_INVOICE_IDS.join(', ')}`)
  console.log()

  for (const [clientName, clientId] of Object.entries(CLIENTS)) {
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`CLIENT: ${clientName}`)
    console.log('─'.repeat(70))

    // Get shipping transactions count
    const { count: shippingCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('reference_type', 'Shipment')
      .eq('transaction_fee', 'Shipping')
      .in('invoice_id_sb', DEC1_INVOICE_IDS)

    // Get storage transactions
    const { data: storageTx, error: storageErr } = await supabase
      .from('transactions')
      .select('reference_id, additional_details')
      .eq('client_id', clientId)
      .eq('reference_type', 'FC')
      .in('invoice_id_sb', DEC1_INVOICE_IDS)
      .limit(1000)

    // Get additional services count
    const { count: addlCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('reference_type', 'Shipment')
      .neq('transaction_fee', 'Shipping')
      .neq('transaction_fee', 'Credit')
      .in('invoice_id_sb', DEC1_INVOICE_IDS)

    // Get returns transactions
    const { data: returnsTx } = await supabase
      .from('transactions')
      .select('reference_id')
      .eq('client_id', clientId)
      .eq('reference_type', 'Return')
      .in('invoice_id_sb', DEC1_INVOICE_IDS)
      .limit(100)

    // Check returns data
    const returnIds = (returnsTx || []).map(r => r.reference_id)
    let returnsWithOriginalShipmentId = 0
    if (returnIds.length > 0) {
      const { data: returnsData } = await supabase
        .from('returns')
        .select('shipbob_return_id, original_shipment_id')
        .in('shipbob_return_id', returnIds)

      returnsWithOriginalShipmentId = (returnsData || []).filter(r => r.original_shipment_id).length
    }

    console.log(`\nTransaction Counts:`)
    console.log(`  Shipping: ${shippingCount || 0}`)
    console.log(`  Additional Services: ${addlCount || 0}`)
    console.log(`  Storage: ${storageTx?.length || 0}`)
    console.log(`  Returns: ${returnsTx?.length || 0}`)

    // Analyze storage data
    if (storageTx && storageTx.length > 0) {
      console.log(`\nStorage Data Analysis:`)

      // Check additional_details
      const withDetailsInventoryId = storageTx.filter(tx => {
        const details = tx.additional_details
        return details?.InventoryId && details.InventoryId !== ''
      }).length

      const withDetailsLocationType = storageTx.filter(tx => {
        const details = tx.additional_details
        return details?.LocationType && details.LocationType !== ''
      }).length

      // Check reference_id parsing
      const withRefIdInventoryId = storageTx.filter(tx => {
        const parts = (tx.reference_id || '').split('-')
        return parts.length >= 2 && parts[1]
      }).length

      const withRefIdLocationType = storageTx.filter(tx => {
        const parts = (tx.reference_id || '').split('-')
        return parts.length >= 3 && parts[2]
      }).length

      console.log(`  From additional_details:`)
      console.log(`    InventoryId: ${withDetailsInventoryId}/${storageTx.length} (${Math.round(100*withDetailsInventoryId/storageTx.length)}%)`)
      console.log(`    LocationType: ${withDetailsLocationType}/${storageTx.length} (${Math.round(100*withDetailsLocationType/storageTx.length)}%)`)
      console.log(`  From reference_id parsing:`)
      console.log(`    InventoryId: ${withRefIdInventoryId}/${storageTx.length} (${Math.round(100*withRefIdInventoryId/storageTx.length)}%)`)
      console.log(`    LocationType: ${withRefIdLocationType}/${storageTx.length} (${Math.round(100*withRefIdLocationType/storageTx.length)}%)`)

      // Combined (what preflight now checks)
      const combinedInventoryId = storageTx.filter(tx => {
        const details = tx.additional_details
        if (details?.InventoryId && details.InventoryId !== '') return true
        const parts = (tx.reference_id || '').split('-')
        return parts.length >= 2 && parts[1]
      }).length

      const combinedLocationType = storageTx.filter(tx => {
        const details = tx.additional_details
        if (details?.LocationType && details.LocationType !== '') return true
        const parts = (tx.reference_id || '').split('-')
        return parts.length >= 3 && parts[2]
      }).length

      console.log(`  Combined (with fallback):`)
      console.log(`    InventoryId: ${combinedInventoryId}/${storageTx.length} (${Math.round(100*combinedInventoryId/storageTx.length)}%) ${combinedInventoryId === storageTx.length ? '✅' : '⚠️'}`)
      console.log(`    LocationType: ${combinedLocationType}/${storageTx.length} (${Math.round(100*combinedLocationType/storageTx.length)}%) ${combinedLocationType === storageTx.length ? '✅' : '⚠️'}`)
    }

    // Returns analysis
    if (returnsTx && returnsTx.length > 0) {
      console.log(`\nReturns Data Analysis:`)
      console.log(`  With original_shipment_id: ${returnsWithOriginalShipmentId}/${returnsTx.length} (${Math.round(100*returnsWithOriginalShipmentId/returnsTx.length)}%) ${returnsWithOriginalShipmentId === returnsTx.length ? '✅' : '⚠️'}`)
    }
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log('TEST COMPLETE')
  console.log('='.repeat(70))
}

runPreflightTest().catch(console.error)
