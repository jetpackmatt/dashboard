import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/cron/preflight-refresh
 *
 * Vercel Cron: Mondays 09:00 UTC (1h before sync-invoices at 10:00 UTC).
 *
 * Why: ShipBob sometimes invoices shipments while our shipments table still shows
 * status=Processing/Pending with NULL tracking/carrier/zone. Our normal child-token
 * sync uses LastUpdateStartDate but ShipBob doesn't reliably bump last_update_at on
 * status transitions, so these go stale. Right before Monday's preflight, do a
 * targeted /order/{id} refresh on every shipment that's referenced by an unprocessed
 * SB invoice but is missing tracking/carrier/zone in our DB.
 *
 * Targeted, low-volume: only touches a handful of shipments per Monday (the exact
 * ones preflight would otherwise complain about). 200ms throttle between API calls.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

const SB_BASE = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

interface ShipmentRow {
  id: string
  shipment_id: string
  shipbob_order_id: string | null
  client_id: string
  status: string | null
  tracking_id: string | null
  carrier: string | null
  carrier_service: string | null
  zone_used: number | null
  length: number | null
  width: number | null
  height: number | null
  actual_weight_oz: number | null
}

interface SBShipment {
  id: number
  status?: string
  tracking?: { tracking_number?: string; tracking_url?: string; carrier?: string; carrier_service?: string }
  measurements?: { length_in?: number; width_in?: number; depth_in?: number; total_weight_oz?: number }
  zone?: { id?: number }
  location?: { name?: string }
  last_update_at?: string
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

async function fetchOrder(token: string, orderId: string): Promise<{ shipments?: SBShipment[] } | null> {
  // Retry 429 (rate limit) and transient errors with backoff. ShipBob's child-token
  // rate limits are bursty — a single brand-wide refresh sometimes hits them.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${SB_BASE}/1.0/order/${orderId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (r.ok) return await r.json()
      if (r.status === 429 || r.status >= 500) {
        await sleep(5000 + attempt * 5000)
        continue
      }
      return null
    } catch {
      await sleep(2000 + attempt * 2000)
    }
  }
  return null
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startedAt = Date.now()

  // 1) Find unprocessed SB invoice IDs
  const { data: unprocessed, error: invErr } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  if (invErr) {
    return NextResponse.json({ error: 'Failed to load unprocessed invoices', details: invErr.message }, { status: 500 })
  }
  if (!unprocessed || unprocessed.length === 0) {
    return NextResponse.json({ success: true, message: 'No unprocessed invoices', refreshed: 0 })
  }

  const sbInvoiceIds = unprocessed
    .map((r: { shipbob_invoice_id: string }) => parseInt(r.shipbob_invoice_id, 10))
    .filter((n: number) => !isNaN(n))

  // 2) Get distinct shipment reference_ids from transactions on those invoices.
  // Cursor pagination: Supabase caps responses at 1000 rows regardless of .limit().
  const refSet = new Set<string>()
  let lastTxId: string | null = null
  while (true) {
    let q = supabase
      .from('transactions')
      .select('id, reference_id')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', sbInvoiceIds)
      .order('id', { ascending: true })
      .limit(1000)
    if (lastTxId) q = q.gt('id', lastTxId)
    const { data: txs, error } = await q
    if (error) {
      return NextResponse.json({ error: 'Failed to load transactions', details: error.message }, { status: 500 })
    }
    if (!txs || txs.length === 0) break
    for (const t of txs as Array<{ id: string; reference_id: string | null }>) {
      if (t.reference_id) refSet.add(String(t.reference_id))
    }
    lastTxId = (txs[txs.length - 1] as { id: string }).id
    if (txs.length < 1000) break
  }

  if (refSet.size === 0) {
    return NextResponse.json({ success: true, message: 'No shipment refs on unprocessed invoices', refreshed: 0 })
  }

  // 3) Find which of those shipments are stale (missing tracking/carrier/zone or in Processing/Pending/None)
  const refIds = [...refSet]
  const stale: ShipmentRow[] = []
  for (let i = 0; i < refIds.length; i += 500) {
    const batch = refIds.slice(i, i + 500)
    const { data: rows } = await supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, client_id, status, tracking_id, carrier, carrier_service, zone_used, length, width, height, actual_weight_oz')
      .in('shipment_id', batch)

    for (const row of (rows || []) as ShipmentRow[]) {
      const statusStale = !row.status || ['Processing', 'Pending', 'None'].includes(row.status)
      const fieldsStale = !row.tracking_id || !row.carrier || !row.carrier_service || row.zone_used == null
      if (statusStale || fieldsStale) stale.push(row)
    }
  }

  console.log(`[PreflightRefresh] ${refSet.size} shipments on unprocessed invoices, ${stale.length} stale`)

  if (stale.length === 0) {
    return NextResponse.json({ success: true, message: 'All shipments fresh', candidates: refSet.size, refreshed: 0 })
  }

  // 4) Load child tokens for the affected clients (one query, in-memory map)
  const clientIds = [...new Set(stale.map((s) => s.client_id))]
  const tokenByClient = new Map<string, string>()
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('client_id, api_token')
    .eq('provider', 'shipbob')
    .in('client_id', clientIds)
  for (const c of creds || []) {
    if (c.api_token) tokenByClient.set(c.client_id, c.api_token)
  }

  // 5) For each stale shipment, fetch /order/{id} via its brand's child token, update DB
  let refreshed = 0
  let unchanged = 0
  let missingToken = 0
  let apiFailed = 0
  let notFoundOnSB = 0

  for (const row of stale) {
    if (Date.now() - startedAt > 270_000) {
      console.warn('[PreflightRefresh] Approaching maxDuration, stopping early')
      break
    }
    if (!row.shipbob_order_id) { apiFailed++; continue }
    const token = tokenByClient.get(row.client_id)
    if (!token) { missingToken++; continue }

    const order = await fetchOrder(token, row.shipbob_order_id)
    await sleep(200)

    if (!order) { apiFailed++; continue }
    const sbShip = (order.shipments || []).find((s) => String(s.id) === row.shipment_id)
    if (!sbShip) { notFoundOnSB++; continue }

    const updates: Record<string, unknown> = {}
    if (sbShip.status && sbShip.status !== row.status) updates.status = sbShip.status
    const newTracking = sbShip.tracking?.tracking_number || null
    if (newTracking && newTracking !== row.tracking_id) {
      updates.tracking_id = newTracking
      updates.tracking_url = sbShip.tracking?.tracking_url || null
    }
    const newCarrier = sbShip.tracking?.carrier || null
    if (newCarrier && newCarrier !== row.carrier) updates.carrier = newCarrier
    const newSvc = sbShip.tracking?.carrier_service || null
    if (newSvc && newSvc !== row.carrier_service) updates.carrier_service = newSvc
    const newZone = sbShip.zone?.id ?? null
    if (newZone != null && newZone !== row.zone_used) updates.zone_used = newZone
    if (sbShip.last_update_at) updates.last_update_at = sbShip.last_update_at

    // Backfill dimensions/weight if missing
    if (!row.length && sbShip.measurements?.length_in) updates.length = sbShip.measurements.length_in
    if (!row.width && sbShip.measurements?.width_in) updates.width = sbShip.measurements.width_in
    if (!row.height && sbShip.measurements?.depth_in) updates.height = sbShip.measurements.depth_in
    if (!row.actual_weight_oz && sbShip.measurements?.total_weight_oz) {
      updates.actual_weight_oz = sbShip.measurements.total_weight_oz
    }

    if (Object.keys(updates).length === 0) { unchanged++; continue }

    updates.updated_at = new Date().toISOString()
    const { error: updErr } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', row.id)

    if (updErr) {
      console.error(`[PreflightRefresh] Update failed for ${row.shipment_id}: ${updErr.message}`)
      apiFailed++
    } else {
      refreshed++
      console.log(`[PreflightRefresh] ${row.shipment_id}: ${Object.keys(updates).filter((k) => k !== 'updated_at').join(', ')}`)
    }
  }

  return NextResponse.json({
    success: true,
    candidates: refSet.size,
    stale: stale.length,
    refreshed,
    unchanged,
    missingToken,
    apiFailed,
    notFoundOnSB,
    elapsedMs: Date.now() - startedAt,
  })
}
