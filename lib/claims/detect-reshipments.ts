import { createAdminClient } from '@/lib/supabase/admin'

interface ShipmentRow {
  shipment_id: string
  shipbob_order_id: string | null
  client_id: string | null
  event_labeled: string | null
  event_delivered: string | null
}

interface OrderRow {
  shipbob_order_id: string
  customer_name: string | null
  zip_code: string | null
}

export interface ReshipmentMatch {
  originalShipmentId: string
  replacementShipmentId: string
  matchType: 'rapid_replacement' | 'manual_reshipment'
  timeDeltaMinutes?: number
  timeDeltaDays?: number
}

/**
 * Detect reshipments for a batch of shipments.
 *
 * Two patterns:
 *   Type 1 — Rapid replacement: same order, sibling labeled within 60 min, original not delivered.
 *   Type 2 — Manual reshipment: different order, same customer+zip, at least 1 shared SKU,
 *            labeled 0–30 days later, original not delivered.
 *
 * Returns a Map keyed by original shipment_id → match details.
 * Does NOT modify any data — caller decides what to do with results.
 */
export async function detectReshipments(
  shipmentIds: string[]
): Promise<Map<string, ReshipmentMatch>> {
  if (shipmentIds.length === 0) return new Map()

  const supabase = createAdminClient()
  const matches = new Map<string, ReshipmentMatch>()

  // ── Query 1: shipment data for the input shipments ──
  const { data: rawInputShipments } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, client_id, event_labeled, event_delivered')
    .in('shipment_id', shipmentIds)
  const inputShipments = rawInputShipments as ShipmentRow[] | null

  if (!inputShipments || inputShipments.length === 0) return matches

  // Only consider originals that were NOT delivered
  const undeliveredInputs = inputShipments.filter(s => !s.event_delivered)
  if (undeliveredInputs.length === 0) return matches

  const shipmentMap = new Map(undeliveredInputs.map(s => [s.shipment_id, s]))
  const undeliveredIds = undeliveredInputs.map(s => s.shipment_id)
  const orderIds = [...new Set(undeliveredInputs.map(s => s.shipbob_order_id).filter(Boolean))] as string[]

  // ── Type 1: Rapid Replacement (same order, <60 min apart, original not delivered) ──
  if (orderIds.length > 0) {
    const { data: rawSiblingShipments } = await supabase
      .from('shipments')
      .select('shipment_id, shipbob_order_id, event_labeled, event_delivered')
      .in('shipbob_order_id', orderIds)
      .not('shipment_id', 'in', `(${undeliveredIds.join(',')})`)
    const siblingShipments = rawSiblingShipments as ShipmentRow[] | null

    if (siblingShipments && siblingShipments.length > 0) {
      // Group siblings by order
      const siblingsByOrder = new Map<string, typeof siblingShipments>()
      for (const sib of siblingShipments) {
        if (!sib.shipbob_order_id) continue
        const list = siblingsByOrder.get(sib.shipbob_order_id) || []
        list.push(sib)
        siblingsByOrder.set(sib.shipbob_order_id, list)
      }

      for (const original of undeliveredInputs) {
        if (!original.shipbob_order_id || !original.event_labeled) continue
        const siblings = siblingsByOrder.get(original.shipbob_order_id)
        if (!siblings) continue

        const origTime = new Date(original.event_labeled).getTime()

        // Find closest sibling labeled within 60 minutes
        let bestMatch: { shipmentId: string; delta: number } | null = null
        for (const sib of siblings) {
          if (!sib.event_labeled) continue
          const sibTime = new Date(sib.event_labeled).getTime()
          const deltaMin = Math.abs(sibTime - origTime) / 60000
          if (deltaMin <= 60 && (!bestMatch || deltaMin < bestMatch.delta)) {
            bestMatch = { shipmentId: sib.shipment_id, delta: deltaMin }
          }
        }

        if (bestMatch) {
          matches.set(original.shipment_id, {
            originalShipmentId: original.shipment_id,
            replacementShipmentId: bestMatch.shipmentId,
            matchType: 'rapid_replacement',
            timeDeltaMinutes: Math.round(bestMatch.delta),
          })
        }
      }
    }
  }

  // ── Type 2: Manual Reshipment (same customer+zip, shared SKU, different order, 0–30 days later) ──
  // Only check shipments that weren't matched by Type 1
  const unmatchedIds = undeliveredIds.filter(id => !matches.has(id))
  if (unmatchedIds.length === 0) return matches

  const unmatchedShipments = unmatchedIds.map(id => shipmentMap.get(id)).filter(Boolean) as typeof undeliveredInputs
  const unmatchedOrderIds = [...new Set(unmatchedShipments.map(s => s.shipbob_order_id).filter(Boolean))] as string[]

  if (unmatchedOrderIds.length === 0) return matches

  // Get order data for customer+zip matching
  const { data: rawOrders } = await supabase
    .from('orders')
    .select('shipbob_order_id, customer_name, zip_code')
    .in('shipbob_order_id', unmatchedOrderIds)
  const orders = rawOrders as OrderRow[] | null

  if (!orders || orders.length === 0) return matches

  const orderMap = new Map(orders.map((o: OrderRow) => [o.shipbob_order_id, o]))

  // Get SKU sets for the unmatched shipments (for partial overlap matching)
  const { data: inputItems } = await supabase
    .from('shipment_items')
    .select('shipment_id, sku')
    .in('shipment_id', unmatchedIds)

  if (!inputItems || inputItems.length === 0) return matches

  // Build SKU set per shipment
  const skuSetMap = new Map<string, Set<string>>()
  for (const item of inputItems) {
    const set = skuSetMap.get(item.shipment_id) || new Set()
    set.add(item.sku)
    skuSetMap.set(item.shipment_id, set)
  }

  // For each unique (client_id, customer_name, zip_code), find candidate replacement orders
  type CustomerKey = { clientId: string; customerName: string; zipCode: string }
  const customerKeys: CustomerKey[] = []
  const shipmentsByCustomerKey = new Map<string, typeof unmatchedShipments>()

  for (const ship of unmatchedShipments) {
    if (!ship.shipbob_order_id || !ship.client_id) continue
    const order = orderMap.get(ship.shipbob_order_id)
    if (!order?.customer_name || !order?.zip_code) continue

    const key = `${ship.client_id}|${order.customer_name}|${order.zip_code}`
    if (!shipmentsByCustomerKey.has(key)) {
      customerKeys.push({ clientId: ship.client_id, customerName: order.customer_name, zipCode: order.zip_code })
      shipmentsByCustomerKey.set(key, [])
    }
    shipmentsByCustomerKey.get(key)!.push(ship)
  }

  // Query candidate orders for each customer key
  const knownOrderIds = new Set(unmatchedOrderIds)
  const candidateOrderIds: string[] = []

  for (const ck of customerKeys) {
    const { data: candidateOrders } = await supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('customer_name', ck.customerName)
      .eq('zip_code', ck.zipCode)
      .not('shipbob_order_id', 'in', `(${[...knownOrderIds].join(',')})`)
      .limit(50)

    if (candidateOrders) {
      for (const co of candidateOrders) {
        candidateOrderIds.push(co.shipbob_order_id)
      }
    }
  }

  if (candidateOrderIds.length === 0) return matches

  // Get shipments for candidate orders
  const { data: rawCandidateShipments } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, client_id, event_labeled')
    .in('shipbob_order_id', candidateOrderIds)
    .limit(500)
  const candidateShipments = rawCandidateShipments as ShipmentRow[] | null

  if (!candidateShipments || candidateShipments.length === 0) return matches

  // Get SKU sets for candidate shipments
  const candidateShipmentIds = candidateShipments.map(s => s.shipment_id)
  const { data: candidateItems } = await supabase
    .from('shipment_items')
    .select('shipment_id, sku')
    .in('shipment_id', candidateShipmentIds)

  const candidateSkuSets = new Map<string, Set<string>>()
  if (candidateItems) {
    for (const item of candidateItems) {
      const set = candidateSkuSets.get(item.shipment_id) || new Set()
      set.add(item.sku)
      candidateSkuSets.set(item.shipment_id, set)
    }
  }

  // Match: same client, same customer+zip, at least 1 shared SKU, labeled 0-30 days later
  for (const [key, ships] of shipmentsByCustomerKey) {
    const [clientId] = key.split('|')

    for (const original of ships) {
      if (matches.has(original.shipment_id)) continue
      if (!original.event_labeled) continue

      const origSkus = skuSetMap.get(original.shipment_id)
      if (!origSkus || origSkus.size === 0) continue

      const origTime = new Date(original.event_labeled).getTime()
      let bestCandidate: { shipmentId: string; daysLater: number } | null = null

      for (const cand of candidateShipments) {
        if (cand.client_id !== clientId) continue
        if (!cand.event_labeled) continue

        const candTime = new Date(cand.event_labeled).getTime()
        const daysLater = (candTime - origTime) / (1000 * 60 * 60 * 24)

        // Must be labeled 0-30 days AFTER the original
        if (daysLater < 0 || daysLater > 30) continue

        // Must have at least 1 shared SKU
        const candSkus = candidateSkuSets.get(cand.shipment_id)
        if (!candSkus) continue
        let hasOverlap = false
        for (const sku of origSkus) {
          if (candSkus.has(sku)) { hasOverlap = true; break }
        }
        if (!hasOverlap) continue

        // Pick the closest match
        if (!bestCandidate || daysLater < bestCandidate.daysLater) {
          bestCandidate = { shipmentId: cand.shipment_id, daysLater: Math.round(daysLater) }
        }
      }

      if (bestCandidate) {
        matches.set(original.shipment_id, {
          originalShipmentId: original.shipment_id,
          replacementShipmentId: bestCandidate.shipmentId,
          matchType: 'manual_reshipment',
          timeDeltaDays: bestCandidate.daysLater,
        })
      }
    }
  }

  return matches
}
