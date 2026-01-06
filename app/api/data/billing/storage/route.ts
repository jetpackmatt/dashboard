import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Storage transactions have reference_type='FC' (Fulfillment Center)
// These are warehousing/storage fees

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

  // FC and Location Type filters
  const fcFilter = searchParams.get('fc')
  const locationTypeFilter = searchParams.get('locationType')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  try {
    // IMPORTANT: Supabase has a 1000 row limit by default
    // Use cursor-based pagination to fetch all records if needed for filtering
    // For simple pagination without post-filters, we can use range()

    const needsPostFiltering = !!locationTypeFilter || !!search

    if (needsPostFiltering) {
      // Need to fetch all data for post-filtering (use cursor pagination)
      const allData: Record<string, unknown>[] = []
      const pageSize = 1000
      let lastId: string | null = null

      while (true) {
        let query = supabase
          .from('transactions')
          .select('*')
          .eq('reference_type', 'FC')
          .order('id', { ascending: true })
          .limit(pageSize)

        if (clientId) {
          query = query.eq('client_id', clientId)
        }
        if (fcFilter) {
          query = query.eq('fulfillment_center', fcFilter)
        }
        if (lastId) {
          query = query.gt('id', lastId)
        }

        const { data, error } = await query

        if (error) {
          console.error('Error fetching storage:', error)
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (!data || data.length === 0) break

        allData.push(...data)
        lastId = data[data.length - 1].id as string

        if (data.length < pageSize) break
      }

      // Map and filter
      let mapped = allData.map((row: Record<string, unknown>) => mapStorageRow(row))

      if (locationTypeFilter) {
        mapped = mapped.filter(item => item.locationType === locationTypeFilter)
      }
      if (search) {
        mapped = mapped.filter(item =>
          item.inventoryId.toLowerCase().includes(search) ||
          item.invoiceNumber.toLowerCase().includes(search) ||
          item.charge.toString().includes(search)
        )
      }

      // Sort by charge date descending
      mapped.sort((a, b) => {
        const dateA = a.chargeStartDate ? new Date(a.chargeStartDate as string).getTime() : 0
        const dateB = b.chargeStartDate ? new Date(b.chargeStartDate as string).getTime() : 0
        return dateB - dateA
      })

      const totalCount = mapped.length
      const paginatedData = mapped.slice(offset, offset + limit)

      return NextResponse.json({
        data: paginatedData,
        totalCount,
        hasMore: (offset + limit) < totalCount,
      })
    } else {
      // No post-filtering needed - use efficient range-based pagination
      let countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('reference_type', 'FC')

      if (clientId) {
        countQuery = countQuery.eq('client_id', clientId)
      }
      if (fcFilter) {
        countQuery = countQuery.eq('fulfillment_center', fcFilter)
      }

      const { count, error: countError } = await countQuery

      if (countError) {
        console.error('Error counting storage:', countError)
        return NextResponse.json({ error: countError.message }, { status: 500 })
      }

      let dataQuery = supabase
        .from('transactions')
        .select('*')
        .eq('reference_type', 'FC')
        .order('charge_date', { ascending: false })
        .range(offset, offset + limit - 1)

      if (clientId) {
        dataQuery = dataQuery.eq('client_id', clientId)
      }
      if (fcFilter) {
        dataQuery = dataQuery.eq('fulfillment_center', fcFilter)
      }

      const { data, error } = await dataQuery

      if (error) {
        console.error('Error fetching storage:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const mapped = (data || []).map((row: Record<string, unknown>) => mapStorageRow(row))

      return NextResponse.json({
        data: mapped,
        totalCount: count || 0,
        hasMore: (offset + limit) < (count || 0),
      })
    }
  } catch (err) {
    console.error('Storage API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper to map a storage transaction row to response format
function mapStorageRow(row: Record<string, unknown>) {
  const refParts = String(row.reference_id || '').split('-')
  const fcId = refParts[0] || ''
  const inventoryId = refParts[1] || ''
  const locationType = refParts[2] || ''
  const details = row.additional_details as Record<string, unknown> || {}

  return {
    id: row.id,
    clientId: row.client_id,
    inventoryId: inventoryId,
    chargeStartDate: row.charge_date,
    fcName: String(row.fulfillment_center || fcId || ''),
    locationType: locationType || String(details.LocationType || ''),
    quantity: Number(details.Quantity || 1),
    ratePerMonth: 0, // Not available in transactions
    charge: parseFloat(String(row.billed_amount || row.cost || 0)) || 0,
    invoiceNumber: String(row.invoice_id_jp || ''),
    invoiceDate: row.invoice_date_jp,
    status: row.invoiced_status_jp ? 'invoiced' : 'pending',
    comment: String(details.Comment || ''),
  }
}
