/**
 * Server-side shipments export endpoint with streaming progress.
 *
 * Streams NDJSON (newline-delimited JSON) events:
 *   {"type":"progress","phase":"shipments","fetched":5000}
 *   {"type":"progress","phase":"details","fetched":101000}
 *   {"type":"progress","phase":"generating","fetched":101000}
 *   {"type":"file","filename":"...","contentType":"...","rowCount":101000,"data":"base64..."}
 *
 * The client reads progress events to update a progress bar, then decodes
 * the base64 file data and triggers a browser download.
 *
 * If ANY database query fails, sends an error event and closes the stream.
 */

import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { SHIPMENTS_INVOICE_COLUMNS } from '@/lib/export-configs'

// Allow up to 5 minutes for large exports (101K+ rows)
export const maxDuration = 300

// ============================================================================
// Batched Supabase .in() query helper
// THROWS on any error — no silent failures.
// ============================================================================
async function batchedInQuery<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  selectFields: string,
  inColumn: string,
  ids: string[],
  additionalFilter?: (q: ReturnType<SupabaseClient['from']>) => ReturnType<SupabaseClient['from']>,
  batchSize = 500,
  concurrency = 10,
): Promise<T[]> {
  if (ids.length === 0) return []

  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += batchSize) {
    batches.push(ids.slice(i, i + batchSize))
  }

  const allResults: T[] = []

  for (let i = 0; i < batches.length; i += concurrency) {
    const wave = batches.slice(i, i + concurrency)
    const waveResults = await Promise.all(
      wave.map(async (batch) => {
        let query = supabase.from(table).select(selectFields).in(inColumn, batch) as any
        if (additionalFilter) {
          query = additionalFilter(query)
        }
        const { data, error } = await query
        if (error) {
          throw new Error(`Failed to query ${table}: ${error.message}`)
        }
        return (data || []) as T[]
      })
    )
    allResults.push(...waveResults.flat())
  }

  return allResults
}

// ============================================================================
// CSV / formatting helpers
// ============================================================================
function escapeCSV(cell: unknown): string {
  const str = String(cell ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatDateForExport(dateStr: string): string {
  if (!dateStr) return ''
  const isDateOnly = dateStr.length === 10 || !dateStr.includes('T')
  try {
    if (isDateOnly) {
      const [year, month, day] = dateStr.split('T')[0].split('-')
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
    }
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    })
  } catch {
    return dateStr
  }
}

function formatExportValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
    return formatDateForExport(value)
  }
  if (key === 'transitTimeDays' && typeof value === 'number') {
    return `${value.toFixed(1)} days`
  }
  if (['charge', 'baseCharge', 'surchargeAmount', 'insuranceCharge'].includes(key)) {
    const num = typeof value === 'number' ? value : parseFloat(String(value))
    if (!isNaN(num)) return `$${num.toFixed(2)}`
  }
  return String(value)
}

// ============================================================================
// POST /api/data/shipments/export
// ============================================================================
export async function POST(request: NextRequest) {
  // Parse request body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    clientId: requestedClientId,
    startDate,
    endDate,
    status: statusFilter = [],
    type: typeFilter = [],
    channel: channelFilter = [],
    carrier: carrierFilter = [],
    age: ageFilter = [],
    search: searchQuery = '',
    format = 'csv'
  } = body as {
    clientId?: string
    startDate?: string
    endDate?: string
    status?: string[]
    type?: string[]
    channel?: string[]
    carrier?: string[]
    age?: string[]
    search?: string
    format?: 'csv' | 'xlsx'
  }

  // CRITICAL SECURITY: Verify user has access BEFORE starting stream
  let clientId: string | null
  try {
    const access = await verifyClientAccess(requestedClientId ?? null)
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }

      try {
        // ==================================================================
        // Phase 1: Fetch ALL shipments via cursor pagination with progress
        // ==================================================================
        const hasDateFilter = !!(startDate || endDate)

        const baseFields = `
          id, shipment_id, shipbob_order_id, tracking_id, recipient_name,
          carrier, carrier_service, status, status_details,
          event_labeled, event_picked, event_packed, event_intransit, event_delivered,
          transit_time_days, fc_name, client_id, application_name, destination_country,
          ship_option_id, zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
          length, width, height
        `
        const ordersJoin = hasDateFilter
          ? 'orders!inner(shipbob_order_id, store_order_id, customer_name, order_import_date, purchase_date, order_type, channel_name, application_name, zip_code, city, state, country)'
          : 'orders(shipbob_order_id, store_order_id, customer_name, order_import_date, purchase_date, order_type, channel_name, application_name, zip_code, city, state, country)'

        const selectFields = `${baseFields}, ${ordersJoin}`

        // Build status filter OR conditions
        let statusOrFilter: string | null = null
        if (Array.isArray(statusFilter) && statusFilter.length > 0) {
          const dbFilters: string[] = []
          for (const s of statusFilter) {
            switch (s.toLowerCase()) {
              case 'delivered': dbFilters.push('event_delivered.not.is.null'); break
              case 'exception':
                dbFilters.push('status_details->0->>name.eq.DeliveryException')
                dbFilters.push('status_details->0->>name.eq.DeliveryAttemptFailed')
                break
              case 'labelled': dbFilters.push('status.eq.LabeledCreated'); break
              case 'awaiting carrier':
                dbFilters.push('status.eq.AwaitingCarrierScan')
                dbFilters.push('status_details->0->>name.eq.AwaitingCarrierScan')
                break
              case 'in transit': dbFilters.push('status_details->0->>name.eq.InTransit'); break
              case 'out for delivery':
                dbFilters.push('and(status_details->0->>name.eq.OutForDelivery,event_delivered.is.null)')
                break
            }
          }
          if (dbFilters.length > 0) {
            statusOrFilter = dbFilters.join(',')
          }
        }

        const allShipments: Record<string, unknown>[] = []
        let lastId: string | null = null

        while (true) {
          let query = supabase
            .from('shipments')
            .select(selectFields)
            .not('event_labeled', 'is', null)
            .is('deleted_at', null)
            .order('id', { ascending: true })
            .limit(1000)

          if (clientId) query = query.eq('client_id', clientId)
          if (startDate) query = query.gte('orders.order_import_date', startDate)
          if (endDate) query = query.lte('orders.order_import_date', `${endDate}T23:59:59.999Z`)
          if (Array.isArray(typeFilter) && typeFilter.length > 0) query = query.in('order_type', typeFilter)
          if (Array.isArray(channelFilter) && channelFilter.length > 0) query = query.in('application_name', channelFilter)
          if (Array.isArray(carrierFilter) && carrierFilter.length > 0) query = query.in('carrier', carrierFilter)
          if (statusOrFilter) query = query.or(statusOrFilter)
          if (lastId) query = query.gt('id', lastId)

          const { data, error } = await query

          if (error) {
            throw new Error(`Database error fetching shipments (page after ${lastId}): ${error.message}`)
          }

          if (!data || data.length === 0) break

          allShipments.push(...data)
          lastId = data[data.length - 1].id as string

          // Stream progress after each page
          send({ type: 'progress', phase: 'shipments', fetched: allShipments.length })

          if (data.length < 1000) break
        }

        // Post-filter: age ranges
        let filteredShipments = allShipments
        if (Array.isArray(ageFilter) && ageFilter.length > 0) {
          const ageRanges = ageFilter.map((range: string) => {
            switch (range) {
              case '0-1': return { min: 0, max: 1 }
              case '1-2': return { min: 1, max: 2 }
              case '2-3': return { min: 2, max: 3 }
              case '3-5': return { min: 3, max: 5 }
              case '5-7': return { min: 5, max: 7 }
              case '7-10': return { min: 7, max: 10 }
              case '10-15': return { min: 10, max: 15 }
              case '15+': return { min: 15, max: Infinity }
              default: return null
            }
          }).filter(Boolean) as { min: number; max: number }[]

          if (ageRanges.length > 0) {
            const now = new Date()
            filteredShipments = allShipments.filter(s => {
              if (!s.event_labeled) return false
              const labelDate = new Date(s.event_labeled as string)
              const end = s.event_delivered ? new Date(s.event_delivered as string) : now
              const ageInDays = (end.getTime() - labelDate.getTime()) / (1000 * 60 * 60 * 24)
              return ageRanges.some(r => ageInDays >= r.min && (r.max === Infinity || ageInDays < r.max))
            })
          }
        }

        // Post-filter: search query
        if (searchQuery) {
          const search = searchQuery.toLowerCase()
          filteredShipments = filteredShipments.filter(s => {
            const order = (s.orders || {}) as Record<string, unknown>
            return (
              String(s.recipient_name || '').toLowerCase().includes(search) ||
              String(s.shipment_id || '').toLowerCase().includes(search) ||
              String(s.tracking_id || '').toLowerCase().includes(search) ||
              String(s.shipbob_order_id || '').toLowerCase().includes(search) ||
              String(order.store_order_id || '').toLowerCase().includes(search)
            )
          })
        }

        if (filteredShipments.length === 0) {
          send({ type: 'error', message: 'No shipments match the current filters' })
          controller.close()
          return
        }

        // ==================================================================
        // Phase 2: Fetch supplementary data
        // ==================================================================
        send({ type: 'progress', phase: 'details', fetched: filteredShipments.length })

        const shipmentIds = filteredShipments.map(s => String(s.shipment_id)).filter(Boolean)
        const trackingIds = filteredShipments.map(s => String(s.tracking_id)).filter(Boolean)

        const [billingData, itemsData, insuranceData, clientsResult] = await Promise.all([
          batchedInQuery(supabase, 'transactions',
            'tracking_id, total_charge, base_charge, surcharge, fee_type, transaction_type, is_voided',
            'tracking_id', trackingIds),
          batchedInQuery(supabase, 'shipment_items',
            'shipment_id, name, quantity',
            'shipment_id', shipmentIds),
          batchedInQuery(supabase, 'transactions',
            'reference_id, total_charge',
            'reference_id', shipmentIds,
            (q: any) => q.ilike('fee_type', '%Insurance%')),
          supabase.from('clients').select('id, merchant_id, company_name'),
        ])

        if (clientsResult.error) {
          throw new Error(`Failed to fetch client data: ${clientsResult.error.message}`)
        }

        // ==================================================================
        // Phase 3: Build lookup maps
        // ==================================================================
        const billingMap: Record<string, { totalCost: number | null }> = {}
        const billingExportMap: Record<string, { baseCharge: number | null; surchargeAmount: number | null; transactionType: string }> = {}
        for (const tx of billingData as Record<string, unknown>[]) {
          if (tx.fee_type === 'Shipping' && tx.transaction_type !== 'Refund' && tx.tracking_id) {
            const totalCost = tx.total_charge != null ? parseFloat(String(tx.total_charge)) || 0 : null
            billingMap[tx.tracking_id as string] = { totalCost }
            billingExportMap[tx.tracking_id as string] = {
              baseCharge: tx.base_charge != null ? parseFloat(String(tx.base_charge)) : null,
              surchargeAmount: tx.surcharge != null ? parseFloat(String(tx.surcharge)) : null,
              transactionType: String(tx.transaction_type || ''),
            }
          }
        }

        const itemCounts: Record<string, number> = {}
        const productsSoldMap: Record<string, string> = {}
        const itemsByShipment: Record<string, { name: string; qty: number }[]> = {}
        for (const item of itemsData as Record<string, unknown>[]) {
          const sid = item.shipment_id as string
          if (!sid) continue
          itemCounts[sid] = (itemCounts[sid] || 0) + 1
          if (!itemsByShipment[sid]) itemsByShipment[sid] = []
          itemsByShipment[sid].push({ name: String(item.name || ''), qty: Number(item.quantity || 1) })
        }
        for (const [sid, items] of Object.entries(itemsByShipment)) {
          productsSoldMap[sid] = items.map(i => `${i.name}(${i.qty})`).join(' ; ')
        }

        const insuranceMap: Record<string, number> = {}
        for (const tx of insuranceData as Record<string, unknown>[]) {
          if (tx.reference_id) {
            const amt = tx.total_charge != null ? parseFloat(String(tx.total_charge)) : 0
            insuranceMap[tx.reference_id as string] = (insuranceMap[tx.reference_id as string] || 0) + amt
          }
        }

        const clientInfoMap: Record<string, { merchantId: string; merchantName: string }> = {}
        for (const c of (clientsResult.data || []) as Record<string, unknown>[]) {
          clientInfoMap[c.id as string] = {
            merchantId: (c.merchant_id as number)?.toString() || '',
            merchantName: String(c.company_name || ''),
          }
        }

        // ==================================================================
        // Phase 4: Map to export rows
        // ==================================================================
        send({ type: 'progress', phase: 'generating', fetched: filteredShipments.length })

        const exportRows = filteredShipments.map(row => {
          const order = (row.orders || {}) as Record<string, unknown>
          const sid = String(row.shipment_id || '')
          const tid = String(row.tracking_id || '')

          return {
            merchantId: clientInfoMap[row.client_id as string]?.merchantId || '',
            merchantName: clientInfoMap[row.client_id as string]?.merchantName || '',
            customerName: String(row.recipient_name || order.customer_name || ''),
            channelName: String(row.application_name || order.application_name || order.channel_name || ''),
            shipmentId: sid,
            transactionType: billingExportMap[tid]?.transactionType || '',
            transactionDate: row.event_labeled || '',
            storeOrderId: String(order.store_order_id || ''),
            trackingId: tid,
            baseCharge: billingExportMap[tid]?.baseCharge ?? null,
            surchargeAmount: billingExportMap[tid]?.surchargeAmount ?? null,
            charge: billingMap[tid]?.totalCost ?? null,
            insuranceCharge: insuranceMap[sid] || null,
            productsSold: productsSoldMap[sid] || '',
            qty: itemCounts[sid] || 1,
            shipOptionId: String(row.ship_option_id || ''),
            carrier: String(row.carrier || ''),
            carrierService: String(row.carrier_service || ''),
            zone: String(row.zone_used || ''),
            actualWeightOz: row.actual_weight_oz != null ? String(row.actual_weight_oz) : '',
            dimWeightOz: row.dim_weight_oz != null ? String(row.dim_weight_oz) : '',
            billableWeightOz: row.billable_weight_oz != null ? String(row.billable_weight_oz) : '',
            lengthIn: row.length != null ? String(row.length) : '',
            widthIn: row.width != null ? String(row.width) : '',
            heightIn: row.height != null ? String(row.height) : '',
            zipCode: String(order.zip_code || ''),
            city: String(order.city || ''),
            state: String(order.state || ''),
            destCountry: String(row.destination_country || order.country || ''),
            orderDate: order.purchase_date || '',
            labelCreated: row.event_labeled || '',
            deliveredDate: row.event_delivered || '',
            transitTimeDays: row.transit_time_days != null ? Number(row.transit_time_days) : null,
            fcName: String(row.fc_name || ''),
          }
        })

        // ==================================================================
        // Phase 5: Generate file and send as base64 in final event
        // ==================================================================
        const headers = SHIPMENTS_INVOICE_COLUMNS.map(c => c.header)
        const keys = SHIPMENTS_INVOICE_COLUMNS.map(c => c.key)
        const timestamp = new Date().toISOString().split('T')[0]

        if (format === 'xlsx') {
          const wsData = [
            headers,
            ...exportRows.map(row =>
              keys.map(key => formatExportValue(key, (row as Record<string, unknown>)[key]))
            ),
          ]
          const ws = XLSX.utils.aoa_to_sheet(wsData)
          ws['!cols'] = headers.map((header, i) => {
            const maxLen = Math.max(
              header.length,
              ...wsData.slice(1, 100).map(r => String(r[i] ?? '').length)
            )
            return { wch: Math.min(maxLen + 2, 50) }
          })

          const wb = XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb, ws, 'Shipments')
          const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
          const base64 = Buffer.from(xlsxBuf).toString('base64')

          send({
            type: 'file',
            filename: `shipments_${timestamp}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            rowCount: exportRows.length,
            data: base64,
          })
        } else {
          const csvLines = [
            headers.map(escapeCSV).join(','),
            ...exportRows.map(row =>
              keys.map(key => escapeCSV(formatExportValue(key, (row as Record<string, unknown>)[key]))).join(',')
            ),
          ]
          const csv = csvLines.join('\n')
          const base64 = Buffer.from(csv, 'utf-8').toString('base64')

          send({
            type: 'file',
            filename: `shipments_${timestamp}.csv`,
            contentType: 'text/csv; charset=utf-8',
            rowCount: exportRows.length,
            data: base64,
          })
        }

        controller.close()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Export failed'
        console.error('Shipments export error:', message)
        send({ type: 'error', message })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}
