import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Allow up to 5 minutes for backfill
export const maxDuration = 300

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

/**
 * Backfill missing order_items and shipment_items
 *
 * This cron runs periodically to catch orders that were synced without their items.
 * This can happen due to:
 * 1. Vercel function timeouts
 * 2. API rate limits
 * 3. Transient API errors
 *
 * Strategy:
 * - Find orders from the last 7 days that have no order_items
 * - Fetch them from ShipBob API and populate order_items + shipment_items
 * - Process in small batches to avoid timeouts
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Backfill Items] Starting...')
  const startTime = Date.now()

  const supabase = createAdminClient()

  try {
    // Get all clients with ShipBob credentials
    const { data: clients } = await supabase
      .from('client_api_credentials')
      .select('client_id, api_token')
      .eq('provider', 'shipbob')

    if (!clients || clients.length === 0) {
      return NextResponse.json({ success: true, message: 'No clients to process' })
    }

    const results = {
      clientsProcessed: 0,
      ordersChecked: 0,
      orderItemsCreated: 0,
      shipmentItemsCreated: 0,
      errors: [] as string[],
    }

    for (const client of clients) {
      const { client_id: clientId, api_token: token } = client

      // Get client's merchant_id
      const { data: clientInfo } = await supabase
        .from('clients')
        .select('merchant_id, company_name')
        .eq('id', clientId)
        .single()

      if (!clientInfo) continue

      const merchantId = clientInfo.merchant_id
      const clientName = clientInfo.company_name

      // Find orders from last 7 days without order_items
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      // First get all orders
      const { data: allOrders } = await supabase
        .from('orders')
        .select('id, shipbob_order_id')
        .eq('client_id', clientId)
        .gte('created_at', sevenDaysAgo.toISOString())
        .limit(500)

      if (!allOrders || allOrders.length === 0) {
        results.clientsProcessed++
        continue
      }

      // Then check which have order_items
      const { data: existingItems } = await supabase
        .from('order_items')
        .select('order_id')
        .in('order_id', allOrders.map((o: { id: string }) => o.id))

      const hasItemsSet = new Set((existingItems || []).map((i: { order_id: string }) => i.order_id))
      const ordersWithoutItems = allOrders.filter((o: { id: string }) => !hasItemsSet.has(o.id)).slice(0, 100)

      if (!ordersWithoutItems || ordersWithoutItems.length === 0) {
        results.clientsProcessed++
        continue
      }

      console.log(`[Backfill Items] ${clientName}: ${ordersWithoutItems.length} orders missing items`)

      // Fetch and populate items for each order
      for (const order of ordersWithoutItems) {
        results.ordersChecked++

        try {
          const res = await fetch(`${SHIPBOB_API_BASE}/order/${order.shipbob_order_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (!res.ok) {
            if (res.status === 429) {
              console.log(`[Backfill Items] Rate limited, stopping for ${clientName}`)
              break
            }
            continue
          }

          const apiOrder = await res.json()

          // Create order_items
          if (apiOrder.products && apiOrder.products.length > 0) {
            const orderItemRecords = apiOrder.products.map((product: {
              id?: number
              sku?: string
              reference_id?: string
              quantity?: number
              unit_price?: number
              upc?: string
              external_line_id?: number
            }) => ({
              client_id: clientId,
              merchant_id: merchantId,
              order_id: order.id,
              shipbob_product_id: product.id || null,
              sku: product.sku || null,
              reference_id: product.reference_id || null,
              quantity: product.quantity || null,
              unit_price: product.unit_price || null,
              upc: product.upc || null,
              external_line_id: product.external_line_id || null,
            }))

            const { error } = await supabase
              .from('order_items')
              .upsert(orderItemRecords, { onConflict: 'order_id,shipbob_product_id' })

            if (!error) {
              results.orderItemsCreated += orderItemRecords.length
            }
          }

          // Create shipment_items
          if (apiOrder.shipments && apiOrder.shipments.length > 0) {
            for (const shipment of apiOrder.shipments) {
              if (!shipment.products || shipment.products.length === 0) continue

              // Build order product quantity lookup
              const orderQtyById: Record<number, number> = {}
              const orderQtyBySku: Record<string, number> = {}
              for (const p of apiOrder.products || []) {
                if (p.quantity) {
                  if (p.id) orderQtyById[p.id] = p.quantity
                  if (p.sku) orderQtyBySku[p.sku] = p.quantity
                }
              }

              const shipmentItemRecords = shipment.products.map((product: {
                id?: number
                sku?: string
                reference_id?: string
                name?: string
                quantity?: number
                is_dangerous_goods?: boolean
                inventory?: Array<{ lot?: string; expiration_date?: string; quantity?: number }>
              }) => {
                const inv = product.inventory?.[0] || {}
                const orderQty = (product.id ? orderQtyById[product.id] : null) ??
                  (product.sku ? orderQtyBySku[product.sku] : null)

                return {
                  client_id: clientId,
                  merchant_id: merchantId,
                  shipment_id: shipment.id.toString(),
                  shipbob_product_id: product.id || null,
                  sku: product.sku || null,
                  reference_id: product.reference_id || null,
                  name: product.name || null,
                  lot: inv.lot || null,
                  expiration_date: inv.expiration_date || null,
                  quantity: inv.quantity || orderQty || product.quantity || null,
                  is_dangerous_goods: product.is_dangerous_goods || false,
                }
              })

              // Delete existing and insert new
              await supabase
                .from('shipment_items')
                .delete()
                .eq('shipment_id', shipment.id.toString())

              const { error } = await supabase
                .from('shipment_items')
                .insert(shipmentItemRecords)

              if (!error) {
                results.shipmentItemsCreated += shipmentItemRecords.length
              }
            }
          }

          // Rate limit: 150 req/min = 400ms between requests
          await new Promise(resolve => setTimeout(resolve, 400))
        } catch (err) {
          results.errors.push(`Order ${order.shipbob_order_id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      }

      results.clientsProcessed++
    }

    const duration = Date.now() - startTime
    console.log(`[Backfill Items] Completed in ${duration}ms`)
    console.log(`[Backfill Items] Created ${results.orderItemsCreated} order_items, ${results.shipmentItemsCreated} shipment_items`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      ...results,
    })
  } catch (error) {
    console.error('[Backfill Items] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
