import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
  isCareAdminRole,
} from '@/lib/supabase/admin'
import { excludeDemoClients } from '@/lib/demo/exclusion'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/misfits
 *
 * Fetch "misfit" transactions — orphaned transactions that need manual attention.
 * A transaction is a misfit if:
 * - client_id IS NULL (any type — unattributed brand)
 * - fee_type = 'Credit' AND care_ticket_id IS NULL (credit not linked to a ticket)
 *
 * Admin and Care Admin only (not care team or brands).
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    if (!access.isAdmin && !isCareAdminRole(access.userRole)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const search = searchParams.get('search')?.trim().toLowerCase()
  const filterType = searchParams.get('type') // 'credit' | 'unattributed' | null (all)
  const feeType = searchParams.get('feeType') // e.g. 'Shipping', 'Storage', 'Credit'
  const referenceType = searchParams.get('referenceType') // e.g. 'Shipment', 'Return', 'Default'

  try {
    const selectFields = 'id, transaction_id, client_id, merchant_id, reference_id, reference_type, cost, currency_code, charge_date, fee_type, transaction_type, fulfillment_center, tracking_id, care_ticket_id, dispute_status, matched_credit_id, additional_details, credit_shipping_portion, billed_amount, markup_is_preview, clients(company_name), care_tickets(id, ticket_number, issue_type, compensation_request, reshipment_status, reshipment_id, shipment_id)'

    // Exclude transactions already handled through admin disputes workflow
    // Only show undisputed transactions (dispute_status IS NULL)
    const disputeExcludeFilter = 'dispute_status.is.null'

    // Common search filter used across all query branches
    const searchOrFilter = search
      ? `reference_id.ilike.%${search}%,transaction_id.ilike.%${search}%,tracking_id.ilike.%${search}%,additional_details->>Comment.ilike.%${search}%,additional_details->>CreditReason.ilike.%${search}%,additional_details->>TicketReference.ilike.%${search}%`
      : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] | null = null
    let fetchError: unknown = null
    let count: number = 0

    // PostgREST doesn't support nested and() inside or(), so we use two queries
    // and merge results for multi-condition filters
    if (filterType === 'credit') {
      // Credit misfits: missing ticket OR pending markup
      // Two queries merged and deduplicated
      let q1 = supabase
        .from('transactions')
        .select(selectFields)
        .eq('is_voided', false)
        .eq('fee_type', 'Credit')
        .is('care_ticket_id', null)
        .or(disputeExcludeFilter)
        .order('charge_date', { ascending: false })
        .limit(500)

      let q2 = supabase
        .from('transactions')
        .select(selectFields)
        .eq('is_voided', false)
        .eq('fee_type', 'Credit')
        .eq('markup_is_preview', true)
        .is('billed_amount', null)
        .or(disputeExcludeFilter)
        .order('charge_date', { ascending: false })
        .limit(500)

      if (referenceType) { q1 = q1.eq('reference_type', referenceType); q2 = q2.eq('reference_type', referenceType) }
      if (searchOrFilter) { q1 = q1.or(searchOrFilter); q2 = q2.or(searchOrFilter) }

      // Exclude demo client credits
      ;[q1, q2] = await Promise.all([
        excludeDemoClients(supabase, q1),
        excludeDemoClients(supabase, q2),
      ])

      const [result1, result2] = await Promise.all([q1, q2])

      if (result1.error) {
        console.error('Error fetching credit misfits:', result1.error)
        return NextResponse.json({ error: 'Failed to fetch misfits' }, { status: 500 })
      }
      if (result2.error) {
        console.error('Error fetching pending markup misfits:', result2.error)
        return NextResponse.json({ error: 'Failed to fetch misfits' }, { status: 500 })
      }

      const seen = new Set<string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const merged: any[] = []
      for (const tx of [...(result1.data || []), ...(result2.data || [])]) {
        if (!seen.has(tx.id)) {
          seen.add(tx.id)
          merged.push(tx)
        }
      }
      merged.sort((a, b) => (b.charge_date || '').localeCompare(a.charge_date || ''))
      data = merged.slice(offset, offset + limit)
      count = merged.length

    } else if (filterType === 'unattributed') {
      // Unattributed brand
      let query = supabase
        .from('transactions')
        .select(selectFields, { count: 'exact' })
        .eq('is_voided', false)
        .is('client_id', null)
        .neq('fee_type', 'Payment')
        .or(disputeExcludeFilter)

      if (feeType) query = query.eq('fee_type', feeType)
      if (referenceType) query = query.eq('reference_type', referenceType)
      if (searchOrFilter) query = query.or(searchOrFilter)

      const result = await query
        .order('charge_date', { ascending: false })
        .range(offset, offset + limit - 1)

      data = result.data
      fetchError = result.error
      count = result.count || 0

    } else {
      // All misfits: three queries merged and deduplicated
      // Q1: unattributed (client_id IS NULL)
      let q1 = supabase
        .from('transactions')
        .select(selectFields)
        .eq('is_voided', false)
        .is('client_id', null)
        .neq('fee_type', 'Payment')
        .or(disputeExcludeFilter)
        .order('charge_date', { ascending: false })
        .limit(500)

      if (feeType) q1 = q1.eq('fee_type', feeType)
      if (referenceType) q1 = q1.eq('reference_type', referenceType)
      if (searchOrFilter) q1 = q1.or(searchOrFilter)

      // Q2: credits without care ticket
      let q2 = supabase
        .from('transactions')
        .select(selectFields)
        .eq('is_voided', false)
        .eq('fee_type', 'Credit')
        .is('care_ticket_id', null)
        .or(disputeExcludeFilter)
        .order('charge_date', { ascending: false })
        .limit(500)

      // feeType filter: if user filters by a non-Credit fee type, q2 returns nothing (fine)
      if (feeType && feeType !== 'Credit') q2 = q2.eq('fee_type', feeType)
      if (referenceType) q2 = q2.eq('reference_type', referenceType)
      if (searchOrFilter) q2 = q2.or(searchOrFilter)

      // Q3: pending markup credits (markup_is_preview=true, billed_amount=NULL)
      let q3 = supabase
        .from('transactions')
        .select(selectFields)
        .eq('is_voided', false)
        .eq('fee_type', 'Credit')
        .eq('markup_is_preview', true)
        .is('billed_amount', null)
        .or(disputeExcludeFilter)
        .order('charge_date', { ascending: false })
        .limit(500)

      if (feeType && feeType !== 'Credit') q3 = q3.eq('fee_type', feeType)
      if (referenceType) q3 = q3.eq('reference_type', referenceType)
      if (searchOrFilter) q3 = q3.or(searchOrFilter)

      // Exclude demo client transactions from all branches (q2/q3 are credits which can have a client_id)
      ;[q2, q3] = await Promise.all([
        excludeDemoClients(supabase, q2),
        excludeDemoClients(supabase, q3),
      ])

      const [result1, result2, result3] = await Promise.all([q1, q2, q3])

      if (result1.error) {
        console.error('Error fetching unattributed misfits:', result1.error)
        return NextResponse.json({ error: 'Failed to fetch misfits' }, { status: 500 })
      }
      if (result2.error) {
        console.error('Error fetching credit misfits:', result2.error)
        return NextResponse.json({ error: 'Failed to fetch misfits' }, { status: 500 })
      }
      if (result3.error) {
        console.error('Error fetching pending markup misfits:', result3.error)
        return NextResponse.json({ error: 'Failed to fetch misfits' }, { status: 500 })
      }

      // Merge and deduplicate by id
      const seen = new Set<string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const merged: any[] = []
      for (const tx of [...(result1.data || []), ...(result2.data || []), ...(result3.data || [])]) {
        if (!seen.has(tx.id)) {
          seen.add(tx.id)
          merged.push(tx)
        }
      }

      // Sort by charge_date descending
      merged.sort((a, b) => (b.charge_date || '').localeCompare(a.charge_date || ''))

      // Manual pagination
      data = merged.slice(offset, offset + limit)
      count = merged.length
    }

    if (fetchError) {
      console.error('Error fetching misfits:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch misfits' }, { status: 500 })
    }

    // Collect shipment IDs from credit misfits that are missing a ticket,
    // then check if any of those shipments already have a "Credit Approved" ticket.
    // This flags potential duplicate credits for the same shipment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creditShipmentIds = (data || [])
      .filter((tx: any) => tx.fee_type === 'Credit' && !tx.care_ticket_id && tx.reference_id && tx.reference_type === 'Shipment')
      .map((tx: any) => tx.reference_id as string)
    const uniqueShipmentIds = [...new Set(creditShipmentIds)]

    const duplicateShipmentIds = new Set<string>()
    if (uniqueShipmentIds.length > 0) {
      // Check for existing tickets with Credit Approved/Resolved on these shipments
      const { data: existingTickets } = await supabase
        .from('care_tickets')
        .select('shipment_id')
        .in('shipment_id', uniqueShipmentIds)
        .in('status', ['Credit Approved', 'Credit Not Approved', 'Resolved'])
        .is('deleted_at', null)

      if (existingTickets) {
        for (const t of existingTickets) {
          if (t.shipment_id) duplicateShipmentIds.add(t.shipment_id)
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (data || []).map((tx: any) => {
      const isCreditType = tx.fee_type === 'Credit'
      const isMissingTicket = isCreditType && !tx.care_ticket_id
      return {
        id: tx.id,
        transactionId: tx.transaction_id,
        clientId: tx.client_id,
        clientName: tx.clients?.company_name || null,
        merchantId: tx.merchant_id,
        referenceId: tx.reference_id,
        referenceType: tx.reference_type,
        cost: parseFloat(tx.cost) || 0,
        currencyCode: tx.currency_code || 'USD',
        chargeDate: tx.charge_date,
        feeType: tx.fee_type,
        transactionType: tx.transaction_type,
        fulfillmentCenter: tx.fulfillment_center,
        trackingId: tx.tracking_id,
        careTicketId: tx.care_ticket_id,
        disputeStatus: tx.dispute_status,
        matchedCreditId: tx.matched_credit_id,
        comment: tx.additional_details?.Comment || null,
        creditReason: tx.additional_details?.CreditReason || null,
        sbTicketRef: tx.additional_details?.TicketReference || null,
        // Computed misfit reason flags
        missingBrand: !tx.client_id,
        missingTicket: isMissingTicket,
        duplicateTicket: isMissingTicket && !!tx.reference_id && duplicateShipmentIds.has(tx.reference_id),
        missingShipment: isCreditType && (!tx.reference_id || tx.reference_type === 'Default'),
        pendingMarkup: isCreditType && tx.markup_is_preview === true && tx.billed_amount === null,
        creditShippingPortion: tx.credit_shipping_portion != null ? parseFloat(tx.credit_shipping_portion) : null,
        careTicket: tx.care_tickets ? {
          id: tx.care_tickets.id,
          ticketNumber: tx.care_tickets.ticket_number,
          issueType: tx.care_tickets.issue_type,
          compensationRequest: tx.care_tickets.compensation_request,
          reshipmentStatus: tx.care_tickets.reshipment_status,
          reshipmentId: tx.care_tickets.reshipment_id,
          shipmentId: tx.care_tickets.shipment_id,
        } : null,
      }
    })

    // Fetch available tickets for smart matching (credits → tickets)
    // These are tickets in "Credit Requested" or "Credit Approved" that aren't
    // already linked to a transaction via care_ticket_id
    const [ticketsResult, linkedResult] = await Promise.all([
      supabase
        .from('care_tickets')
        .select('id, ticket_number, ticket_type, status, shipment_id, credit_amount, client_id, created_at, clients(company_name)')
        .is('deleted_at', null)
        .in('status', ['Credit Requested', 'Credit Approved'])
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('transactions')
        .select('care_ticket_id')
        .not('care_ticket_id', 'is', null),
    ])

    // Filter out tickets already linked to a transaction
    const linkedIds = new Set(
      (linkedResult.data || []).map((r: { care_ticket_id: string }) => r.care_ticket_id)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const availableTickets = (ticketsResult.data || [])
      .filter((t: { id: string }) => !linkedIds.has(t.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((t: any) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        ticketType: t.ticket_type,
        status: t.status,
        shipmentId: t.shipment_id,
        creditAmount: parseFloat(t.credit_amount) || 0,
        clientId: t.client_id,
        clientName: t.clients?.company_name || null,
        createdAt: t.created_at,
      }))

    return NextResponse.json({
      data: mapped,
      totalCount: count || 0,
      availableTickets,
    })
  } catch (err) {
    console.error('Error in misfits route:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
