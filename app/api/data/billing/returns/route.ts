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

  // Date filtering
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  // Status filter
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || []

  try {
    let query = supabase
      .from('billing_returns')
      .select('*', { count: 'exact' })

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Date range filter on return_creation_date
    if (startDate) {
      query = query.gte('return_creation_date', startDate)
    }
    if (endDate) {
      query = query.lte('return_creation_date', `${endDate}T23:59:59.999Z`)
    }

    // Status filter
    if (statusFilter.length > 0) {
      query = query.in('transaction_status', statusFilter)
    }

    const { data, error, count } = await query
      .order('return_creation_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching returns:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format matching XLS columns
    const mapped = (data || []).map((row: any) => ({
      id: row.id,
      returnId: row.return_id?.toString() || '',
      originalOrderId: row.original_order_id?.toString() || '',
      trackingId: row.tracking_id || '',
      transactionType: row.transaction_type || '',
      returnStatus: row.return_status || '',
      returnType: row.return_type || '',
      returnCreationDate: row.return_creation_date,
      fcName: row.fc_name || '',
      amount: parseFloat(row.amount) || 0,
      invoiceNumber: row.invoice_number?.toString() || '',
      invoiceDate: row.invoice_date,
      status: row.transaction_status || 'pending',
    }))

    return NextResponse.json({
      data: mapped,
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Returns API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
