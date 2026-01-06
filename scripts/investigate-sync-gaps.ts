#!/usr/bin/env npx tsx
/**
 * Investigate sync gaps between ShipBob API and our database
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Check transactions without invoice_id_sb for Dec 8-15
  console.log('=== Transactions WITHOUT invoice_id_sb (Dec 8-15) ===')
  const { data: noInvoice, count: noInvCount } = await supabase
    .from('transactions')
    .select('reference_type, fee_type, cost, charge_date', { count: 'exact' })
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-08')
    .lte('charge_date', '2025-12-15')
    .order('charge_date', { ascending: false })
    .limit(100)

  console.log('Total without invoice_id_sb:', noInvCount)

  // Group by reference_type
  const byType: Record<string, { count: number; total: number }> = {}
  for (const tx of noInvoice || []) {
    if (!byType[tx.reference_type]) byType[tx.reference_type] = { count: 0, total: 0 }
    byType[tx.reference_type].count++
    byType[tx.reference_type].total += tx.cost
  }
  console.log('Sample breakdown by type:', byType)

  // Check specifically Return transactions without invoice
  console.log('\n=== Return transactions in Dec without invoice_id_sb ===')
  const { data: returnsNoInv, count: returnCount } = await supabase
    .from('transactions')
    .select('reference_id, fee_type, cost, charge_date', { count: 'exact' })
    .eq('reference_type', 'Return')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-01')

  console.log('Total Return tx without invoice:', returnCount)
  for (const r of returnsNoInv || []) {
    console.log(`  ${r.reference_id}: ${r.fee_type} $${r.cost} on ${r.charge_date}`)
  }

  // Check what ShipBob API knows vs what we have
  console.log('\n=== Total transactions by reference_type (Dec 8-15) ===')
  const { data: allTx } = await supabase
    .from('transactions')
    .select('reference_type, invoice_id_sb')
    .gte('charge_date', '2025-12-08')
    .lte('charge_date', '2025-12-15')

  const summary: Record<string, { total: number; withInvoice: number }> = {}
  for (const tx of allTx || []) {
    if (!summary[tx.reference_type]) summary[tx.reference_type] = { total: 0, withInvoice: 0 }
    summary[tx.reference_type].total++
    if (tx.invoice_id_sb) summary[tx.reference_type].withInvoice++
  }

  for (const [type, stats] of Object.entries(summary)) {
    const pct = ((stats.withInvoice / stats.total) * 100).toFixed(1)
    console.log(`  ${type}: ${stats.total} total, ${stats.withInvoice} with invoice (${pct}%)`)
  }

  // Compare actual vs expected for specific invoices
  console.log('\n=== Invoice Totals: Expected vs Actual ===')
  const invoiceTargets = [
    { id: 8693044, type: 'Shipping', amount: 32472.38 },
    { id: 8693054, type: 'ReturnsFee', amount: 69.03 },
    { id: 8693051, type: 'AdditionalFee', amount: 2722.08 },
    { id: 8693047, type: 'WarehouseInboundFee', amount: 220 },
  ]

  for (const inv of invoiceTargets) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('cost')
      .eq('invoice_id_sb', inv.id)

    const actualTotal = (txs || []).reduce((sum, t) => sum + t.cost, 0)
    const diff = inv.amount - actualTotal
    console.log(`  Invoice ${inv.id} (${inv.type}):`)
    console.log(`    Expected: $${inv.amount.toFixed(2)}`)
    console.log(`    Actual:   $${actualTotal.toFixed(2)} (${txs?.length || 0} tx)`)
    console.log(`    Diff:     $${diff.toFixed(2)} ${diff > 0 ? '⚠️ MISSING' : ''}`)
  }
}

main().catch(console.error)
