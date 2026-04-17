import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { checkPermission } from '@/lib/permissions'
import { NextRequest, NextResponse } from 'next/server'

// Return transactions have reference_type='Return'
// We join with the returns table to get actual return data

export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
    const denied = checkPermission(access, 'transactions.returns')
    if (denied) return denied
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Date filtering
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  // Return filters
  const returnStatus = searchParams.get('returnStatus')
  const returnType = searchParams.get('returnType')

  // Sort params
  const sortField = searchParams.get('sortField') || 'charge_date'
  const sortAscending = searchParams.get('sortDirection') === 'asc'

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  // Export mode - includes extra fields for invoice-format export
  const isExport = searchParams.get('export') === 'true'

  try {
    // If return status or type filters are applied, we need to filter by returns table first
    let filteredReturnIds: string[] | null = null

    if (returnStatus || returnType) {
      let returnsQuery = supabase
        .from('returns')
        .select('shipbob_return_id')

      if (clientId) {
        returnsQuery = returnsQuery.eq('client_id', clientId)
      }

      if (returnStatus) {
        returnsQuery = returnsQuery.eq('status', returnStatus)
      }

      if (returnType) {
        returnsQuery = returnsQuery.eq('return_type', returnType)
      }

      const { data: returnsData } = await returnsQuery

      if (returnsData && returnsData.length > 0) {
        filteredReturnIds = returnsData.map((r: Record<string, unknown>) => String(r.shipbob_return_id))
      } else {
        // No returns match the filter, return empty result
        return NextResponse.json({
          data: [],
          totalCount: 0,
          hasMore: false,
        })
      }
    }

    // When searching, pre-resolve matching return IDs from the returns table
    // so we can filter server-side before pagination.
    let searchReturnIds: string[] | null = null
    if (search) {
      let returnsSearchQuery = supabase
        .from('returns')
        .select('shipbob_return_id')
        .or(`shipbob_return_id.ilike.%${search}%,original_shipment_id.ilike.%${search}%,tracking_number.ilike.%${search}%`)
      if (clientId) returnsSearchQuery = returnsSearchQuery.eq('client_id', clientId)

      const { data: matchingReturns } = await returnsSearchQuery

      searchReturnIds = (matchingReturns || []).map((r: Record<string, unknown>) => String(r.shipbob_return_id))
    }

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('reference_type', 'Return')

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Date range filter on charge_date
    if (startDate) {
      query = query.gte('charge_date', startDate)
    }
    if (endDate) {
      query = query.lte('charge_date', `${endDate}T23:59:59.999Z`)
    }

    // If we have filtered return IDs, apply that filter
    if (filteredReturnIds) {
      query = query.in('reference_id', filteredReturnIds)
    }

    // Server-side search: match reference_id directly OR any return IDs resolved
    // from the returns table (original_shipment_id, tracking_number matches)
    if (search && searchReturnIds) {
      if (searchReturnIds.length > 0) {
        query = query.or(`reference_id.ilike.%${search}%,reference_id.in.(${searchReturnIds.join(',')})`)
      } else {
        query = query.ilike('reference_id', `%${search}%`)
      }
    }

    const { data: transactions, error, count } = await query
      .order(sortField, { ascending: sortAscending })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching returns:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get the return IDs to fetch from returns table
    const returnIds = (transactions || [])
      .map((t: Record<string, unknown>) => t.reference_id)
      .filter(Boolean)

    // Fetch actual return data from returns table
    let returnsMap: Record<string, Record<string, unknown>> = {}
    if (returnIds.length > 0) {
      const { data: returnsData } = await supabase
        .from('returns')
        .select('shipbob_return_id, original_shipment_id, return_type, tracking_number, status')
        .in('shipbob_return_id', returnIds)

      if (returnsData) {
        returnsMap = returnsData.reduce((acc: Record<string, Record<string, unknown>>, r: Record<string, unknown>) => {
          acc[String(r.shipbob_return_id)] = r
          return acc
        }, {})
      }
    }

    // Export: look up client merchant_id and company_name
    let clientInfoMap: Record<string, { merchantId: string; merchantName: string }> = {}
    if (isExport) {
      const clientIds = [...new Set((transactions || []).map((r: Record<string, unknown>) => r.client_id).filter(Boolean))]
      if (clientIds.length > 0) {
        const { data: clients } = await supabase.from('clients').select('id, merchant_id, company_name').in('id', clientIds as string[])
        if (clients) {
          for (const c of clients) {
            clientInfoMap[c.id] = { merchantId: c.merchant_id?.toString() || '', merchantName: c.company_name || '' }
          }
        }
      }
    }

    // Map to response format
    // Use billed_amount (marked-up amount) for Charge column
    // CRITICAL: Never show raw cost to clients - return null if billed_amount not yet calculated
    // Merge data from returns table for actual return details
    let mapped = (transactions || []).map((row: Record<string, unknown>) => {
      const returnId = String(row.reference_id || '')
      const returnData = returnsMap[returnId] || {}

      return {
        id: row.id,
        clientId: row.client_id,
        returnId: returnId,
        originalShipmentId: returnData.original_shipment_id ? String(returnData.original_shipment_id) : '',
        trackingNumber: String(returnData.tracking_number || ''),
        returnStatus: String(returnData.status || ''),
        returnType: String(returnData.return_type || ''),
        returnCreationDate: row.charge_date,
        fcName: String(row.fulfillment_center || ''),
        // Return billed_amount if available, null otherwise (UI shows "-")
        charge: row.billed_amount !== null && row.billed_amount !== undefined
          ? parseFloat(String(row.billed_amount)) || 0
          : null,
        invoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        status: row.invoiced_status_jp ? 'invoiced' : 'pending',
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

    const totalCount = count || 0
    const paginatedData = mapped

    return NextResponse.json({
      data: paginatedData,
      totalCount,
      hasMore: (offset + limit) < totalCount,
    })
  } catch (err) {
    console.error('Returns API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
