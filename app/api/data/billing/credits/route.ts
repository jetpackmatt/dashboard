import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Credit transactions have transaction_fee='Credit' or negative amounts

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

  // Credit reason filter
  const creditReason = searchParams.get('creditReason')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  try {
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('fee_type', 'Credit')

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

    // Credit reason filter - filter by CreditReason in additional_details JSON
    if (creditReason) {
      query = query.contains('additional_details', { CreditReason: creditReason })
    }

    const { data, error, count } = await query
      .order('charge_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching credits:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format matching XLS columns
    // Use billed_amount (marked-up amount) for Credit column
    // Credits are typically stored as negative amounts
    let mapped = (data || []).map((row: Record<string, unknown>) => {
      const details = row.additional_details as Record<string, unknown> || {}
      const amount = parseFloat(String(row.billed_amount || row.cost || 0)) || 0

      return {
        id: row.id,
        referenceId: String(row.reference_id || ''),
        transactionDate: row.charge_date,
        sbTicketReference: String(details.TicketReference || ''),
        creditInvoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        creditReason: String(details.Comment || details.CreditReason || ''),
        creditAmount: Math.abs(amount), // Display as positive
        status: row.invoiced_status_jp ? 'invoiced' : 'pending',
      }
    })

    // Apply search filter post-mapping
    if (search) {
      mapped = mapped.filter((item: { referenceId: string; sbTicketReference: string; creditInvoiceNumber: string; creditAmount: number }) =>
        item.referenceId.toLowerCase().includes(search) ||
        item.sbTicketReference.toLowerCase().includes(search) ||
        item.creditInvoiceNumber.toLowerCase().includes(search) ||
        item.creditAmount.toString().includes(search)
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
    console.error('Credits API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
