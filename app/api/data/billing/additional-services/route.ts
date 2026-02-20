import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Additional services are non-shipping transactions (fees that aren't the base shipping cost)
// These include: Per Pick Fee, B2B fees, Warehousing Fee, etc.
// Excludes: Shipping (which is the base shipment cost)
// Note: Some fees (like Inventory Placement Program Fee) have reference_type='WRO'
// but still belong here, so we filter by fee_type only (not reference_type)
const ADDITIONAL_SERVICE_FEES = [
  'Per Pick Fee',
  'B2B - Each Pick Fee',
  'B2B - Label Fee',
  'B2B - Case Pick Fee',
  'B2B - Pallet Pick Fee',
  'B2B - ASIN Fee',
  'B2B - Order Fee',
  'B2B - Pallet Material Charge',
  'B2B - Pallet Pack Fee',
  'B2B - ShipBob Freight Fee',
  'B2B - Supplies',
  'Inventory Placement Program Fee',
  'Warehousing Fee',
  'Multi-Hub IQ Fee',
  'Kitting Fee',
  'VAS Fee',
  'VAS - Paid Requests',
  'Duty/Tax',
  'Insurance',
  'Signature Required',
  'Fuel Surcharge',
  'Residential Surcharge',
  'Delivery Area Surcharge',
  'Saturday Delivery',
  'Oversized Package',
  'Dimensional Weight',
  'Address Correction',
  'Others',
]

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

  // Sort params
  const sortField = searchParams.get('sortField') || 'charge_date'
  const sortAscending = searchParams.get('sortDirection') === 'asc'

  // Date filtering
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  // Status filter (maps to invoiced_status_jp for Jetpack invoices)
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || []

  // Fee type filter (single specific fee type)
  const feeTypeFilter = searchParams.get('feeType')

  // Search query
  const search = searchParams.get('search')?.trim().toLowerCase()

  // Export mode - includes extra fields for invoice-format export
  const isExport = searchParams.get('export') === 'true'

  try {
    // Filter by fee_type only (not reference_type) since some fees like
    // "Inventory Placement Program Fee" have reference_type='WRO' but belong here
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })

    // If specific fee type requested, filter by that; otherwise show all allowed types
    if (feeTypeFilter && ADDITIONAL_SERVICE_FEES.includes(feeTypeFilter)) {
      query = query.eq('fee_type', feeTypeFilter)
    } else {
      query = query.in('fee_type', ADDITIONAL_SERVICE_FEES)
    }

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Date range filter (use charge_date)
    if (startDate) {
      query = query.gte('charge_date', startDate)
    }
    if (endDate) {
      query = query.lte('charge_date', `${endDate}T23:59:59.999Z`)
    }

    // Status filter - convert to Jetpack invoiced status
    if (statusFilter.length > 0) {
      const invoicedStatuses = statusFilter.map(s => s === 'invoiced' || s === 'completed')
      if (invoicedStatuses.includes(true) && !invoicedStatuses.includes(false)) {
        query = query.eq('invoiced_status_jp', true)
      } else if (invoicedStatuses.includes(false) && !invoicedStatuses.includes(true)) {
        query = query.eq('invoiced_status_jp', false)
      }
    }

    // Search filter - reference_id
    if (search) {
      query = query.ilike('reference_id', `%${search}%`)
    }

    const { data, error, count } = await query
      .order(sortField, { ascending: sortAscending })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching additional services:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Export: look up client merchant_id and company_name
    let clientInfoMap: Record<string, { merchantId: string; merchantName: string }> = {}
    if (isExport) {
      const clientIds = [...new Set((data || []).map((r: Record<string, unknown>) => r.client_id).filter(Boolean))]
      if (clientIds.length > 0) {
        const { data: clients } = await supabase.from('clients').select('id, merchant_id, company_name').in('id', clientIds as string[])
        if (clients) {
          for (const c of clients) {
            clientInfoMap[c.id] = { merchantId: c.merchant_id?.toString() || '', merchantName: c.company_name || '' }
          }
        }
      }
    }

    // Map to response format matching XLS columns
    // Use billed_amount (marked-up amount) for Charge column
    // CRITICAL: Never show raw cost to clients - return null if billed_amount not yet calculated
    // Use Jetpack invoice fields (invoice_id_jp, invoice_date_jp) instead of ShipBob
    const mapped = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      clientId: row.client_id,
      referenceId: row.reference_id || '',
      feeType: row.fee_type || '',
      // Return billed_amount if available, null otherwise (UI shows "-")
      charge: row.billed_amount !== null && row.billed_amount !== undefined
        ? parseFloat(String(row.billed_amount)) || 0
        : null,
      transactionDate: row.charge_date,
      invoiceNumber: row.invoice_id_jp?.toString() || '',
      invoiceDate: row.invoice_date_jp,
      status: row.invoiced_status_jp ? 'invoiced' : 'pending',
      // Include preview flag for UI styling (optional indicator)
      isPreview: row.markup_is_preview === true,
      // Export-only fields
      ...(isExport ? {
        merchantId: clientInfoMap[row.client_id as string]?.merchantId || '',
        merchantName: clientInfoMap[row.client_id as string]?.merchantName || '',
      } : {}),
    }))

    return NextResponse.json({
      data: mapped,
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Additional Services API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
