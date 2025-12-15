import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Receiving transactions are WRO-specific fees (actual receiving/inbound fees)
// We join with receiving_orders table to get status and contents
// Note: Some fees like "Inventory Placement Program Fee" have reference_type='WRO'
// but belong in Additional Services, so we filter by specific fee types

const RECEIVING_FEE_TYPES = [
  'WRO Receiving Fee',
  'Receiving Fee',
  'Inbound Fee',
  'Dock Receiving Fee',
  'Pallet Receiving Fee',
  'Case Receiving Fee',
  'Unit Receiving Fee',
]

// Helper to extract contents from WRO data
// Uses purchase_order_number if available, otherwise extracts SKUs from inventory_quantities
function getWroContents(wro: Record<string, unknown>): string {
  // First try purchase_order_number
  const poNumber = wro.purchase_order_number
  if (poNumber && String(poNumber).trim()) {
    return String(poNumber)
  }

  // Fallback: extract unique SKUs from inventory_quantities
  const inventoryQuantities = wro.inventory_quantities as Array<{ sku?: string }> | null
  if (inventoryQuantities && Array.isArray(inventoryQuantities)) {
    const skus = inventoryQuantities
      .map(item => item.sku)
      .filter((sku): sku is string => Boolean(sku))
    if (skus.length > 0) {
      // Join unique SKUs, limit to first 3 for display
      const uniqueSkus = [...new Set(skus)]
      if (uniqueSkus.length <= 3) {
        return uniqueSkus.join(', ')
      }
      return `${uniqueSkus.slice(0, 3).join(', ')} +${uniqueSkus.length - 3} more`
    }
  }

  return ''
}

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const clientIdParam = searchParams.get('clientId')
  const clientId = clientIdParam === 'all' ? null : (clientIdParam || DEFAULT_CLIENT_ID)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Date filtering
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  // Receiving status filter (from receiving_orders table)
  const receivingStatus = searchParams.get('receivingStatus')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  try {
    // ==========================================
    // 1. Fetch billed WRO transactions
    // ==========================================
    // Only include specific receiving fee types (not all WRO reference_type transactions)
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .or(RECEIVING_FEE_TYPES.map(f => `fee_type.ilike.%${f}%`).join(','))

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Date range filter
    if (startDate) {
      query = query.gte('charge_date', startDate)
    }
    if (endDate) {
      query = query.lte('charge_date', `${endDate}T23:59:59.999Z`)
    }

    const { data: transactions, error } = await query
      .order('charge_date', { ascending: false })

    if (error) {
      console.error('Error fetching receiving:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get the WRO IDs that have been billed
    const billedWroIds = new Set(
      (transactions || [])
        .map((t: Record<string, unknown>) => {
          const refId = String(t.reference_id || '')
          return parseInt(refId.replace(/\D/g, '')) || 0
        })
        .filter((id: number) => id > 0)
    )

    // ==========================================
    // 2. Fetch unbilled WROs from receiving_orders
    // ==========================================
    // These are WROs that exist but haven't been charged yet
    let unbilledWrosQuery = supabase
      .from('receiving_orders')
      .select('*')
      .not('status', 'eq', 'Cancelled')  // Exclude cancelled WROs

    if (clientId) {
      unbilledWrosQuery = unbilledWrosQuery.eq('client_id', clientId)
    }

    // Date range filter for unbilled WROs (using insert_date)
    if (startDate) {
      unbilledWrosQuery = unbilledWrosQuery.gte('insert_date', startDate)
    }
    if (endDate) {
      unbilledWrosQuery = unbilledWrosQuery.lte('insert_date', `${endDate}T23:59:59.999Z`)
    }

    // Receiving status filter for unbilled WROs
    if (receivingStatus) {
      unbilledWrosQuery = unbilledWrosQuery.eq('status', receivingStatus)
    }

    const { data: allWros } = await unbilledWrosQuery
      .order('insert_date', { ascending: false })

    // Filter to only unbilled WROs
    const unbilledWros = (allWros || []).filter(
      (wro: Record<string, unknown>) => !billedWroIds.has(Number(wro.shipbob_receiving_id))
    )

    // ==========================================
    // 3. Build receiving_orders lookup for billed WROs
    // ==========================================
    let receivingMap: Record<number, Record<string, unknown>> = {}
    if (billedWroIds.size > 0) {
      const { data: receivingData } = await supabase
        .from('receiving_orders')
        .select('shipbob_receiving_id, status, purchase_order_number, inventory_quantities')
        .in('shipbob_receiving_id', Array.from(billedWroIds))

      if (receivingData) {
        receivingMap = receivingData.reduce((acc: Record<number, Record<string, unknown>>, r: Record<string, unknown>) => {
          acc[Number(r.shipbob_receiving_id)] = r
          return acc
        }, {})
      }
    }

    // ==========================================
    // 4. Map billed transactions to response format
    // ==========================================
    const billedMapped = (transactions || []).map((row: Record<string, unknown>) => {
      const refId = String(row.reference_id || '')
      const wroId = parseInt(refId.replace(/\D/g, '')) || 0
      const receivingData = receivingMap[wroId] || {}

      return {
        id: row.id,
        wroId: refId,
        receivingStatus: String(receivingData.status || ''),
        contents: getWroContents(receivingData),
        feeType: String(row.fee_type || ''),
        charge: parseFloat(String(row.billed_amount || row.cost || 0)) || 0,
        transactionDate: row.charge_date,
        invoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        isPending: false,
      }
    })

    // ==========================================
    // 5. Map unbilled WROs to response format
    // ==========================================
    const unbilledMapped = unbilledWros.map((wro: Record<string, unknown>) => ({
      id: `wro-${wro.shipbob_receiving_id}`,  // Prefix to avoid ID collision
      wroId: String(wro.shipbob_receiving_id),
      receivingStatus: String(wro.status || ''),
      contents: getWroContents(wro),
      feeType: '',  // No fee type yet - not billed
      charge: 0,
      transactionDate: wro.insert_date,
      invoiceNumber: '',
      invoiceDate: null,
      isPending: true,  // Mark as pending (not yet billed)
    }))

    // ==========================================
    // 6. Combine, filter, and sort by date (most recent first)
    // ==========================================
    let allMapped = [...billedMapped, ...unbilledMapped]

    // Apply receiving status filter to combined result (for billed transactions)
    if (receivingStatus) {
      allMapped = allMapped.filter(item => item.receivingStatus === receivingStatus)
    }

    // Apply search filter
    if (search) {
      allMapped = allMapped.filter((item: { wroId: string; contents: string; invoiceNumber: string; charge: number }) =>
        item.wroId.toLowerCase().includes(search) ||
        item.contents.toLowerCase().includes(search) ||
        item.invoiceNumber.toLowerCase().includes(search) ||
        item.charge.toString().includes(search)
      )
    }

    // Sort by date
    allMapped.sort((a, b) => {
      const dateA = a.transactionDate ? new Date(a.transactionDate as string).getTime() : 0
      const dateB = b.transactionDate ? new Date(b.transactionDate as string).getTime() : 0
      return dateB - dateA
    })

    // Apply pagination to the combined result
    const totalCount = allMapped.length
    const paginatedData = allMapped.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginatedData,
      totalCount,
      hasMore: (offset + limit) < totalCount,
    })
  } catch (err) {
    console.error('Receiving API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
