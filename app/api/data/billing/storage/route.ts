import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

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
      .from('billing_storage')
      .select('*', { count: 'exact' })

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Status filter
    if (statusFilter.length > 0) {
      query = query.in('transaction_status', statusFilter)
    }

    const { data, error, count } = await query
      .order('invoice_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching storage:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format matching XLS columns
    const mapped = (data || []).map((row: any) => ({
      id: row.id,
      inventoryId: row.inventory_id?.toString() || '',
      chargeStartDate: row.charge_start_date,
      fcName: row.fc_name || '',
      locationType: row.location_type || '',
      quantity: row.quantity || 0,
      ratePerMonth: parseFloat(row.rate_per_month) || 0,
      amount: parseFloat(row.amount) || 0,
      invoiceNumber: row.invoice_number?.toString() || '',
      invoiceDate: row.invoice_date,
      status: row.transaction_status || 'pending',
      comment: row.comment || '',
    }))

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
