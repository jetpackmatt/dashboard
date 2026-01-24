import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Credit transactions have transaction_fee='Credit' or negative amounts

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
    // CRITICAL: Never show raw cost to clients - return null if billed_amount not yet calculated
    // Credits are typically stored as negative amounts
    let mapped = (data || []).map((row: Record<string, unknown>) => {
      const details = row.additional_details as Record<string, unknown> || {}

      // Return billed_amount if available, null otherwise (UI shows "-")
      let creditAmount: number | null = null
      if (row.billed_amount !== null && row.billed_amount !== undefined) {
        const amount = parseFloat(String(row.billed_amount)) || 0
        creditAmount = Math.abs(amount) // Display as positive
      }

      return {
        id: row.id,
        clientId: row.client_id,
        referenceId: String(row.reference_id || ''),
        transactionDate: row.charge_date,
        sbTicketReference: String(details.TicketReference || ''),
        creditInvoiceNumber: row.invoice_id_jp?.toString() || '',
        invoiceDate: row.invoice_date_jp,
        creditReason: String(details.Comment || details.CreditReason || ''),
        creditAmount,
        status: row.invoiced_status_jp ? 'invoiced' : 'pending',
        // Include preview flag for UI styling (optional indicator)
        isPreview: row.markup_is_preview === true,
      }
    })

    // Apply search filter post-mapping
    if (search) {
      mapped = mapped.filter((item: { referenceId: string; sbTicketReference: string; creditInvoiceNumber: string; creditAmount: number | null }) =>
        item.referenceId.toLowerCase().includes(search) ||
        item.sbTicketReference.toLowerCase().includes(search) ||
        item.creditInvoiceNumber.toLowerCase().includes(search) ||
        (item.creditAmount !== null && item.creditAmount.toString().includes(search))
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
