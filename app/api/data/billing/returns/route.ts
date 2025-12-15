import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Return transactions have reference_type='Return'
// We join with the returns table to get actual return data

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

  // Return filters
  const returnStatus = searchParams.get('returnStatus')
  const returnType = searchParams.get('returnType')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

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

    const { data: transactions, error, count } = await query
      .order('charge_date', { ascending: false })
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

    // Map to response format
    // Use billed_amount (marked-up amount) for Charge column
    // Merge data from returns table for actual return details
    let mapped = (transactions || []).map((row: Record<string, unknown>) => {
      const returnId = String(row.reference_id || '')
      const returnData = returnsMap[returnId] || {}

      return {
        id: row.id,
        returnId: returnId,
        originalShipmentId: returnData.original_shipment_id ? String(returnData.original_shipment_id) : '',
        trackingNumber: String(returnData.tracking_number || ''),
        returnStatus: String(returnData.status || ''),
        returnType: String(returnData.return_type || ''),
        returnCreationDate: row.charge_date,
        fcName: String(row.fulfillment_center || ''),
        charge: parseFloat(String(row.billed_amount || row.cost || 0)) || 0,
        invoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        status: row.invoiced_status_jp ? 'invoiced' : 'pending',
      }
    })

    // Apply search filter post-mapping (to search across multiple fields)
    if (search) {
      mapped = mapped.filter((item: { returnId: string; originalShipmentId: string; trackingNumber: string; invoiceNumber: string; charge: number }) =>
        item.returnId.toLowerCase().includes(search) ||
        item.originalShipmentId.toLowerCase().includes(search) ||
        item.trackingNumber.toLowerCase().includes(search) ||
        item.invoiceNumber.toLowerCase().includes(search) ||
        item.charge.toString().includes(search)
      )
    }

    // Apply pagination after search filter
    const totalCount = search ? mapped.length : (count || 0)
    const paginatedData = search ? mapped.slice(offset, offset + limit) : mapped

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
