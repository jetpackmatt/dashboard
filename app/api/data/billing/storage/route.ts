import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Storage transactions have reference_type='FC' (Fulfillment Center)
// These are warehousing/storage fees

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const clientIdParam = searchParams.get('clientId')
  const clientId = clientIdParam === 'all' ? null : (clientIdParam || DEFAULT_CLIENT_ID)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // FC and Location Type filters
  const fcFilter = searchParams.get('fc')
  const locationTypeFilter = searchParams.get('locationType')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  try {
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('reference_type', 'FC') // Storage transactions are FC reference type

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // FC filter (fulfillment_center column)
    if (fcFilter) {
      query = query.eq('fulfillment_center', fcFilter)
    }

    // Location type filter - requires post-processing since it's in reference_id
    // reference_id format: {FC_ID}-{InventoryId}-{LocationType}
    // We'll filter after fetching since Supabase can't do this easily

    const { data, error, count } = await query
      .order('charge_date', { ascending: false })

    if (error) {
      console.error('Error fetching storage:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format matching XLS columns
    // Use billed_amount (marked-up amount) for Charge column
    // reference_id for FC is format: {FC_ID}-{InventoryId}-{LocationType}
    let mapped = (data || []).map((row: Record<string, unknown>) => {
      const refParts = String(row.reference_id || '').split('-')
      const fcId = refParts[0] || ''
      const inventoryId = refParts[1] || ''
      const locationType = refParts[2] || ''
      const details = row.additional_details as Record<string, unknown> || {}

      return {
        id: row.id,
        inventoryId: inventoryId,
        chargeStartDate: row.charge_date,
        fcName: String(row.fulfillment_center || fcId || ''),
        locationType: locationType || String(details.LocationType || ''),
        quantity: Number(details.Quantity || 1),
        ratePerMonth: 0, // Not available in transactions
        charge: parseFloat(String(row.billed_amount || row.cost || 0)) || 0,
        invoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        status: row.invoiced_status_jp ? 'invoiced' : 'pending',
        comment: String(details.Comment || ''),
      }
    })

    // Apply location type filter after mapping
    if (locationTypeFilter) {
      mapped = mapped.filter((item: { locationType: string }) => item.locationType === locationTypeFilter)
    }

    // Apply search filter
    if (search) {
      mapped = mapped.filter((item: { inventoryId: string; invoiceNumber: string; charge: number }) =>
        item.inventoryId.toLowerCase().includes(search) ||
        item.invoiceNumber.toLowerCase().includes(search) ||
        item.charge.toString().includes(search)
      )
    }

    // Calculate total count after filtering
    const totalCount = mapped.length

    // Apply pagination
    const paginatedData = mapped.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginatedData,
      totalCount,
      hasMore: (offset + limit) < totalCount,
    })
  } catch (err) {
    console.error('Storage API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
