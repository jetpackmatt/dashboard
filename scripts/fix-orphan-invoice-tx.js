#!/usr/bin/env node
/**
 * Fix orphaned transactions that have invoice_id_sb = NULL
 * Uses the same logic as the DB fallback in sync-invoices
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixRemaining() {
  // Get pending invoices
  const { data: pending } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, period_start, period_end, invoice_date')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  console.log('Processing', pending?.length, 'pending invoices...')

  for (const inv of pending || []) {
    const periodStart = inv.period_start?.split('T')[0]
    const periodEnd = inv.period_end?.split('T')[0]
    if (!periodStart || !periodEnd) continue

    // Build query based on invoice type
    let query = supabase
      .from('transactions')
      .select('transaction_id')
      .is('invoice_id_sb', null)
      .is('dispute_status', null)
      .gte('charge_date', periodStart)
      .lte('charge_date', periodEnd + 'T23:59:59Z')

    switch (inv.invoice_type) {
      case 'Shipping':
        query = query.eq('reference_type', 'Shipment').eq('fee_type', 'Shipping')
        break
      case 'AdditionalFee':
        query = query.eq('reference_type', 'Shipment').not('fee_type', 'in', '("Shipping","Credit")')
        break
      case 'WarehouseStorage':
        query = query.eq('reference_type', 'FC')
        break
      case 'WarehouseInboundFee':
        query = query.in('reference_type', ['WRO', 'URO'])
        break
      case 'ReturnsFee':
        query = query.eq('reference_type', 'Return')
        break
      case 'Credits':
        query = query.eq('fee_type', 'Credit')
        break
      default:
        continue
    }

    const { data: unlinked } = await query

    if (unlinked && unlinked.length > 0) {
      const txIds = unlinked.map(t => t.transaction_id)
      const { data: updated, error } = await supabase
        .from('transactions')
        .update({
          invoice_id_sb: parseInt(inv.shipbob_invoice_id),
          invoice_date_sb: inv.invoice_date,
          invoiced_status_sb: true
        })
        .in('transaction_id', txIds)
        .select('id')

      if (error) {
        console.log('  Error:', inv.invoice_type, inv.shipbob_invoice_id, error.message)
      } else {
        console.log('  Linked', updated?.length, 'to', inv.invoice_type, inv.shipbob_invoice_id)
      }
    }
  }

  console.log('Done!')
}

fixRemaining().catch(console.error)
