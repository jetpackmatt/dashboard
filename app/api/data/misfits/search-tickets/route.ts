import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
  isCareAdminRole,
} from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/misfits/search-tickets
 *
 * Search care tickets for the Command popover in Misfits page.
 * Smart search: numeric input searches ticket_number, otherwise searches
 * shipment_id, tracking_number, and description via ilike.
 *
 * Admin and Care Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await verifyClientAccess(null)
    if (!access.isAdmin && !isCareAdminRole(access.userRole)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('q')?.trim()
  const typeFilter = searchParams.get('type')
  const statusFilter = searchParams.get('status')
  const clientIdFilter = searchParams.get('clientId')
  const awaitingCredit = searchParams.get('awaitingCredit') === '1'

  try {
    // Get ticket IDs that already have a credit transaction linked — exclude from results
    // Paginate to handle >1000 linked tickets safely
    const allLinkedIds: string[] = []
    let linkedLastId: string | null = null
    while (true) {
      let linkedQuery = supabase
        .from('transactions')
        .select('care_ticket_id')
        .not('care_ticket_id', 'is', null)
        .eq('fee_type', 'Credit')
        .order('care_ticket_id', { ascending: true })
        .limit(1000)
      if (linkedLastId) {
        linkedQuery = linkedQuery.gt('care_ticket_id', linkedLastId)
      }
      const { data: page } = await linkedQuery
      if (!page || page.length === 0) break
      for (const r of page) {
        allLinkedIds.push(r.care_ticket_id)
      }
      linkedLastId = page[page.length - 1].care_ticket_id
      if (page.length < 1000) break
    }
    const linkedTicketIds = new Set(allLinkedIds)

    let query = supabase
      .from('care_tickets')
      .select('id, ticket_number, ticket_type, issue_type, status, shipment_id, tracking_number, client_id, description, credit_amount, clients(company_name)')
      .is('deleted_at', null)
      .limit(20)

    // Smart search across multiple fields including all reference IDs
    if (search) {
      if (/^\d+$/.test(search)) {
        // Numeric: could be ticket number, shipment ID, order ID, work order ID, or inventory ID
        query = query.or(`ticket_number.eq.${search},shipment_id.ilike.%${search}%,order_id.ilike.%${search}%,work_order_id.ilike.%${search}%,inventory_id.ilike.%${search}%`)
      } else {
        // Text: search all reference ID fields, tracking number, description
        query = query.or(`shipment_id.ilike.%${search}%,order_id.ilike.%${search}%,tracking_number.ilike.%${search}%,work_order_id.ilike.%${search}%,inventory_id.ilike.%${search}%,description.ilike.%${search}%`)
      }
    }

    if (typeFilter) {
      query = query.eq('ticket_type', typeFilter)
    }
    if (awaitingCredit) {
      // Show tickets that ever had "Credit Requested" and are not yet resolved.
      // Care admins may add "In Process" updates after credit was requested — still awaiting credit.
      query = query
        .neq('status', 'Resolved')
        .contains('events', [{ status: 'Credit Requested' }])
    } else if (statusFilter) {
      // Support comma-separated status values
      const statuses = statusFilter.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        query = query.eq('status', statuses[0])
      } else if (statuses.length > 1) {
        query = query.in('status', statuses)
      }
    }
    if (clientIdFilter) {
      query = query.eq('client_id', clientIdFilter)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Error searching tickets:', error)
      return NextResponse.json({ error: 'Failed to search tickets' }, { status: 500 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = (data || [])
      .filter((t: any) => !linkedTicketIds.has(t.id)) // Exclude tickets that already have a credit linked
      .map((t: any) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        ticketType: t.ticket_type,
        issueType: t.issue_type,
        status: t.status,
        shipmentId: t.shipment_id,
        trackingNumber: t.tracking_number,
        clientId: t.client_id,
        clientName: t.clients?.company_name || null,
        description: t.description,
        creditAmount: parseFloat(t.credit_amount) || 0,
      }))

    return NextResponse.json({ data: mapped })
  } catch (err) {
    console.error('Error in search-tickets route:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
