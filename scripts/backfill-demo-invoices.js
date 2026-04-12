#!/usr/bin/env node
/**
 * Generate fake Jetpack invoices for the demo client by bundling its
 * transactions into weekly invoices (Monday-to-Sunday billing periods).
 *
 * For each week with demo transactions:
 *   1. Create an `invoices_jetpack` row with status='sent', paid_status='paid'
 *      (for past weeks) or 'approved' (for the current week)
 *   2. Update the transactions to reference the invoice via invoice_id_jp
 *
 * Invoice numbering: JPPB-NNNN-MMDDYY (matches the existing format).
 *
 * Usage:
 *   node scripts/backfill-demo-invoices.js <DEMO_CLIENT_ID>
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const DEMO_CLIENT_ID = process.argv[2]
if (!DEMO_CLIENT_ID) {
  console.error('Usage: node backfill-demo-invoices.js <DEMO_CLIENT_ID>')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// Monday of the week containing d (UTC)
function mondayOf(d) {
  const dt = new Date(d)
  const dow = dt.getUTCDay() // 0=Sun..6=Sat
  const deltaToMon = dow === 0 ? -6 : 1 - dow
  dt.setUTCDate(dt.getUTCDate() + deltaToMon)
  dt.setUTCHours(0, 0, 0, 0)
  return dt
}
function sundayOf(monday) {
  const d = new Date(monday)
  d.setUTCDate(d.getUTCDate() + 6)
  d.setUTCHours(23, 59, 59, 999)
  return d
}

function fmtInvoiceNumber(seq, d) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `JPPB-${String(seq).padStart(4, '0')}-${mm}${dd}${yy}`
}

async function main() {
  console.log(`\n🧾 Backfilling demo invoices for ${DEMO_CLIENT_ID}\n`)

  // Group transactions by week (ISO Monday)
  const weekMap = new Map()
  let lastId = null
  while (true) {
    let q = supabase
      .from('transactions')
      .select('id, transaction_id, charge_date, billed_amount, cost, fee_type, invoiced_status_jp')
      .eq('client_id', DEMO_CLIENT_ID)
      .is('invoice_id_jp', null)
      .order('id', { ascending: true })
      .limit(1000)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    for (const tx of data) {
      if (!tx.charge_date) continue
      const mon = mondayOf(tx.charge_date)
      const key = mon.toISOString().split('T')[0]
      if (!weekMap.has(key)) weekMap.set(key, { monday: mon, txs: [] })
      weekMap.get(key).txs.push(tx)
    }
    lastId = data[data.length - 1].id
    if (data.length < 1000) break
  }

  console.log(`Grouped transactions into ${weekMap.size} weekly buckets`)

  const weeks = [...weekMap.values()].sort((a, b) => a.monday - b.monday)

  // Find next invoice_number sequence
  const { data: lastInv } = await supabase
    .from('invoices_jetpack')
    .select('invoice_number')
    .eq('client_id', DEMO_CLIENT_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let seq = lastInv ? (parseInt((lastInv.invoice_number || '').split('-')[1] || '0', 10) + 1) : 1

  const now = new Date()
  let totalCreated = 0
  for (const w of weeks) {
    const periodStart = w.monday.toISOString().split('T')[0]
    const periodEnd = sundayOf(w.monday).toISOString().split('T')[0]
    const invoiceDate = new Date(w.monday); invoiceDate.setUTCDate(invoiceDate.getUTCDate() + 7) // Monday after
    const invDateStr = invoiceDate.toISOString().split('T')[0]
    const invoiceNumber = fmtInvoiceNumber(seq++, invoiceDate)
    const subtotal = w.txs.reduce((s, t) => s + Number(t.cost || 0), 0)
    const total = w.txs.reduce((s, t) => s + Number(t.billed_amount || 0), 0)
    const markup = total - subtotal
    const isFuture = invoiceDate > now
    if (isFuture) continue
    const daysSince = Math.floor((now - invoiceDate) / 86400_000)
    const status = 'sent'
    const paidStatus = daysSince > 10 ? 'paid' : 'unpaid'
    const paidAt = paidStatus === 'paid' ? new Date(invoiceDate.getTime() + randBizDays(3, 10) * 86400_000).toISOString() : null

    const lineItems = buildLineItems(w.txs)

    const { data: inserted, error } = await supabase.from('invoices_jetpack').insert({
      id: crypto.randomUUID(),
      client_id: DEMO_CLIENT_ID,
      invoice_number: invoiceNumber,
      invoice_date: invDateStr,
      period_start: periodStart,
      period_end: periodEnd,
      subtotal: +subtotal.toFixed(2),
      total_markup: +markup.toFixed(2),
      total_amount: +total.toFixed(2),
      status,
      paid_status: paidStatus,
      paid_at: paidAt,
      generated_at: invoiceDate.toISOString(),
      approved_at: invoiceDate.toISOString(),
      line_items_json: lineItems,
      shipbob_invoice_ids: [],
      version: 1,
      created_at: invoiceDate.toISOString(),
      updated_at: invoiceDate.toISOString(),
    }).select('id, invoice_number').single()
    if (error) { console.warn(`  week ${periodStart}: ${error.message}`); seq--; continue }

    // Link transactions
    const txIds = w.txs.map(t => t.id)
    for (let i = 0; i < txIds.length; i += 500) {
      await supabase.from('transactions')
        .update({ invoice_id_jp: inserted.invoice_number, invoice_date_jp: invoiceDate.toISOString(), invoiced_status_jp: true })
        .in('id', txIds.slice(i, i + 500))
    }
    totalCreated++
    if (totalCreated % 5 === 0) process.stdout.write(`  created ${totalCreated}\r`)
  }
  console.log(`\n✅ Created ${totalCreated} demo invoices`)
}

function randBizDays(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function buildLineItems(txs) {
  const byFeeType = new Map()
  for (const tx of txs) {
    const ft = tx.fee_type || 'Other'
    const e = byFeeType.get(ft) || { fee_type: ft, count: 0, cost: 0, billed: 0 }
    e.count++
    e.cost += Number(tx.cost || 0)
    e.billed += Number(tx.billed_amount || 0)
    byFeeType.set(ft, e)
  }
  return [...byFeeType.values()].map(e => ({
    fee_type: e.fee_type, count: e.count,
    cost: +e.cost.toFixed(2),
    markup: +(e.billed - e.cost).toFixed(2),
    total: +e.billed.toFixed(2),
  }))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
