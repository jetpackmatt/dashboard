import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Receiving transactions have reference_type='WRO' (Warehouse Receiving Order)
// or transaction_fee contains 'Receiving'

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
    // WRO = Warehouse Receiving Order
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .or('reference_type.eq.WRO,fee_type.ilike.%Receiving%')

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
      console.error('Error fetching receiving:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format matching XLS columns
    const mapped = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      referenceId: String(row.reference_id || ''),
      feeType: String(row.fee_type || ''),
      amount: parseFloat(String(row.cost || 0)) || 0,
      transactionType: String(row.transaction_type || ''),
      transactionDate: row.charge_date,
      invoiceNumber: row.invoice_id_sb?.toString() || '',
      invoiceDate: row.invoice_date_sb,
      status: row.invoiced_status_sb ? 'invoiced' : 'pending',
    }))

    return NextResponse.json({
      data: mapped,
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Receiving API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
