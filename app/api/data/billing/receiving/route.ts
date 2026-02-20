import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Receiving transactions are WRO-specific fees (actual receiving/inbound fees)
// We join with receiving_orders table to get status and contents
// Note: Some fees like "Inventory Placement Program Fee" have reference_type='WRO'
// but belong in Additional Services, so we filter by specific fee types

const RECEIVING_FEE_TYPES = [
  'WRO Receiving Fee',
  'WRO Label Fee',
  'URO Storage Fee',
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
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Sort params
  const sortField = searchParams.get('sortField') || 'charge_date'
  const sortAscending = searchParams.get('sortDirection') === 'asc'

  // Date filtering
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  // Receiving status filter (from receiving_orders table)
  const receivingStatus = searchParams.get('receivingStatus')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  // Export mode - includes extra fields for invoice-format export
  const isExport = searchParams.get('export') === 'true'

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
      .order(sortField, { ascending: sortAscending })

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
    // Export: look up client merchant_id and company_name
    // ==========================================
    let clientInfoMap: Record<string, { merchantId: string; merchantName: string }> = {}
    if (isExport) {
      const { data: clients } = await supabase.from('clients').select('id, merchant_id, company_name')
      if (clients) {
        for (const c of clients as any[]) {
          clientInfoMap[c.id] = { merchantId: c.merchant_id?.toString() || '', merchantName: c.company_name || '' }
        }
      }
    }

    // ==========================================
    // 4. Map billed transactions to response format
    // CRITICAL: Never show raw cost to clients - return null if billed_amount not yet calculated
    // ==========================================
    const billedMapped = (transactions || []).map((row: Record<string, unknown>) => {
      const refId = String(row.reference_id || '')
      const wroId = parseInt(refId.replace(/\D/g, '')) || 0
      const receivingData = receivingMap[wroId] || {}

      return {
        id: row.id,
        clientId: row.client_id,
        wroId: refId,
        receivingStatus: String(receivingData.status || ''),
        contents: getWroContents(receivingData),
        feeType: String(row.fee_type || ''),
        // Return billed_amount if available, null otherwise (UI shows "-")
        charge: row.billed_amount !== null && row.billed_amount !== undefined
          ? parseFloat(String(row.billed_amount)) || 0
          : null,
        transactionDate: row.charge_date,
        invoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        isPending: false,
        // Include preview flag for UI styling (optional indicator)
        isPreview: row.markup_is_preview === true,
        // Export-only fields
        ...(isExport ? {
          merchantId: clientInfoMap[row.client_id as string]?.merchantId || '',
          merchantName: clientInfoMap[row.client_id as string]?.merchantName || '',
          transactionType: String(row.transaction_type || ''),
        } : {}),
      }
    })

    // ==========================================
    // 5. Map unbilled WROs to response format
    // ==========================================
    const unbilledMapped = unbilledWros.map((wro: Record<string, unknown>) => ({
      id: `wro-${wro.shipbob_receiving_id}`,  // Prefix to avoid ID collision
      clientId: wro.client_id,
      wroId: String(wro.shipbob_receiving_id),
      receivingStatus: String(wro.status || ''),
      contents: getWroContents(wro),
      feeType: '',  // No fee type yet - not billed
      charge: 0,
      transactionDate: wro.insert_date ? String(wro.insert_date).split('T')[0] : null,
      invoiceNumber: '',
      invoiceDate: null,
      isPending: true,  // Mark as pending (not yet billed)
      // Export-only fields
      ...(isExport ? {
        merchantId: clientInfoMap[wro.client_id as string]?.merchantId || '',
        merchantName: clientInfoMap[wro.client_id as string]?.merchantName || '',
        transactionType: '',
      } : {}),
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
      allMapped = allMapped.filter((item: { wroId: string; contents: string; invoiceNumber: string; charge: number | null }) =>
        item.wroId.toLowerCase().includes(search) ||
        item.contents.toLowerCase().includes(search) ||
        item.invoiceNumber.toLowerCase().includes(search) ||
        (item.charge !== null && item.charge.toString().includes(search))
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
