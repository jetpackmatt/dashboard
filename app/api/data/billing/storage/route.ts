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

  // Status filter
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || []

  try {
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('reference_type', 'FC') // Storage transactions are FC reference type

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Status filter - convert to invoiced status
    if (statusFilter.length > 0) {
      const invoicedStatuses = statusFilter.map(s => s === 'invoiced' || s === 'completed')
      if (invoicedStatuses.includes(true) && !invoicedStatuses.includes(false)) {
        query = query.eq('invoiced_status_sb', true)
      } else if (invoicedStatuses.includes(false) && !invoicedStatuses.includes(true)) {
        query = query.eq('invoiced_status_sb', false)
      }
    }

    const { data, error, count } = await query
      .order('charge_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching storage:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format matching XLS columns
    // reference_id for FC is format: {FC_ID}-{InventoryId}-{LocationType}
    const mapped = (data || []).map((row: Record<string, unknown>) => {
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
        amount: parseFloat(String(row.cost || 0)) || 0,
        invoiceNumber: row.invoice_id_sb?.toString() || '',
        invoiceDate: row.invoice_date_sb,
        status: row.invoiced_status_sb ? 'invoiced' : 'pending',
        comment: String(details.Comment || ''),
      }
    })

    return NextResponse.json({
      data: mapped,
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Storage API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
