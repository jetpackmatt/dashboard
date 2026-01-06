#!/usr/bin/env node
/**
 * Check shipping transaction counts - preflight shows 2107 but expected 2327
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Henson client ID
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Get pending ShipBob invoices
  const { data: pendingInv } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, period_start, period_end')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  console.log('Pending ShipBob invoices:')
  const invoiceIds = []
  for (const inv of pendingInv || []) {
    console.log(' ', inv.shipbob_invoice_id, inv.invoice_type,
      inv.period_start?.split('T')[0], '-', inv.period_end?.split('T')[0])
    invoiceIds.push(parseInt(inv.shipbob_invoice_id))
  }

  const shippingInv = (pendingInv || []).find(i => i.invoice_type === 'Shipping')
  const periodStart = shippingInv?.period_start?.split('T')[0]
  const periodEnd = shippingInv?.period_end?.split('T')[0]

  console.log('\n=== PREFLIGHT EXACT QUERY (fee_type=Shipping, ref_type=Shipment) ===')

  // EXACT preflight query for Henson
  const { count: preflightCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', invoiceIds)
    .is('dispute_status', null)

  console.log('Henson Shipping transactions in preflight query:', preflightCount)

  // Check with ONLY invoice 8730385 (the Shipping invoice)
  const { count: shippingInvOnly } = await supabase
    .from('transactions')
    .select('id', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', parseInt(shippingInv?.shipbob_invoice_id))
    .is('dispute_status', null)

  console.log('Henson in Shipping invoice only (8730385):', shippingInvOnly)

  // Check shipments table count for the period
  const { count: shipmentsCount } = await supabase
    .from('shipments')
    .select('shipment_id', { count: 'exact' })
    .eq('client_id', hensonId)
    .gte('shipped_date', periodStart)
    .lte('shipped_date', periodEnd)

  console.log('\n=== SHIPMENTS TABLE ===')
  console.log('Shipments by shipped_date (Dec 15-21):', shipmentsCount)

  // Also check by created_at
  const { count: shipByCreated } = await supabase
    .from('shipments')
    .select('shipment_id', { count: 'exact' })
    .eq('client_id', hensonId)
    .gte('event_created', periodStart)
    .lte('event_created', periodEnd + 'T23:59:59Z')

  console.log('Shipments by event_created (Dec 15-21):', shipByCreated)

  // Check how many Shipping transactions have a matching shipment in shipments table
  console.log('\n=== CROSS-CHECK ===')

  // Get all shipping transactions reference_ids
  const { data: shippingTx } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', invoiceIds)
    .is('dispute_status', null)
    .limit(3000)

  const txShipmentIds = (shippingTx || []).map(t => t.reference_id)
  console.log('Shipping tx reference_ids count:', txShipmentIds.length)

  // Check how many of these exist in shipments table
  if (txShipmentIds.length > 0) {
    let foundCount = 0
    for (let i = 0; i < txShipmentIds.length; i += 500) {
      const batch = txShipmentIds.slice(i, i + 500)
      const { count } = await supabase
        .from('shipments')
        .select('shipment_id', { count: 'exact' })
        .eq('client_id', hensonId)
        .in('shipment_id', batch)

      foundCount += count || 0
    }
    console.log('Of these, found in shipments table:', foundCount)
    console.log('Missing from shipments table:', txShipmentIds.length - foundCount)
  }

  // Check for transactions with NULL invoice_id_sb
  const { count: nullInvCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', periodStart)
    .lte('charge_date', periodEnd)
    .is('dispute_status', null)

  console.log('\nWith NULL invoice_id_sb in period:', nullInvCount)

  // Check by fee_type distribution for all Shipment ref_type
  const { data: allFeeTypes } = await supabase
    .from('transactions')
    .select('fee_type')
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', invoiceIds)
    .is('dispute_status', null)
    .limit(5000)

  const ftCounts = {}
  for (const tx of allFeeTypes || []) {
    ftCounts[tx.fee_type] = (ftCounts[tx.fee_type] || 0) + 1
  }
  console.log('\nAll Shipment tx by fee_type:')
  for (const [ft, c] of Object.entries(ftCounts).sort((a, b) => b[1] - a[1])) {
    console.log(' ', ft, ':', c)
  }
}

main().catch(console.error)
