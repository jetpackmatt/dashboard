import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
  isCareAdminRole,
} from '@/lib/supabase/admin'
import { excludeDemoClients } from '@/lib/demo/exclusion'
import { checkPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { createCareTicket } from '@/lib/claims/create-care-ticket'
import { NextRequest, NextResponse } from 'next/server'

interface MappedTicket {
  id: unknown
  ticketNumber: unknown
  clientId: unknown
  clientName: string
  partner: 'shipbob' | 'eshipper'
  ticketType: unknown
  issueType: unknown
  status: unknown
  manager: unknown
  orderId: string | null
  shipmentId: unknown
  shipDate: unknown
  carrier: unknown
  trackingNumber: string | null
  reshipmentStatus: unknown
  whatToReship: unknown
  reshipmentId: unknown
  compensationRequest: unknown
  creditAmount: number
  currency: unknown
  workOrderId: unknown
  inventoryId: unknown
  description: string | null
  internalNotes: unknown
  events: Array<Record<string, unknown>>
  latestNote: string | null
  lastUpdated: unknown
  createdAt: unknown
  updatedAt: unknown
  resolvedAt: unknown
}

/**
 * GET /api/data/care-tickets
 *
 * Fetch care tickets with filtering and pagination.
 * - Admin and Care users can see all clients' tickets
 * - Regular users can only see tickets for their own clients
 * - Supports filtering by status, type, issue, client, and date range
 */
export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  let isCareUser: boolean
  let isAdmin: boolean
  let access
  try {
    access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
    isCareUser = access.isCareUser
    isAdmin = access.isAdmin
  } catch (error) {
    return handleAccessError(error)
  }

  const denied = checkPermission(access, 'care')
  if (denied) return denied

  const supabase = createAdminClient()
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Filters
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || []
  const typeFilter = searchParams.get('type')?.split(',').filter(Boolean) || []
  const issueFilter = searchParams.get('issue')?.split(',').filter(Boolean) || []
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const search = searchParams.get('search')?.trim().toLowerCase()

  try {
    // Build query with client join to get client name
    let query = supabase
      .from('care_tickets')
      .select(`
        *,
        clients(company_name)
      `, { count: 'exact' })

    // Filter by client if specified (or if user is not admin/care)
    if (clientId) {
      query = query.eq('client_id', clientId)
    } else {
      // All-brands view: exclude demo client tickets
      query = await excludeDemoClients(supabase, query, 'client_id')
    }

    // Status filter
    if (statusFilter.length > 0) {
      query = query.in('status', statusFilter)
    }

    // Type filter
    if (typeFilter.length > 0) {
      query = query.in('ticket_type', typeFilter)
    }

    // Issue filter
    if (issueFilter.length > 0) {
      query = query.in('issue_type', issueFilter)
    }

    // Date range filter on created_at
    if (startDate) {
      query = query.gte('created_at', startDate)
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59.999Z`)
    }

    // Exclude soft-deleted tickets unless explicitly requested
    const includeDeleted = searchParams.get('includeDeleted') === 'true'
    if (!includeDeleted) {
      query = query.is('deleted_at', null)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching care tickets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map to response format
    let mapped: MappedTicket[] = (data || []).map((row: Record<string, unknown>) => {
      const clientData = row.clients as Record<string, unknown> | null
      const events = (row.events as Array<Record<string, unknown>>) || []
      const latestEvent = events[0] || null

      return {
        id: row.id,
        ticketNumber: row.ticket_number,
        clientId: row.client_id,
        clientName: clientData?.company_name || 'Unknown',
        // Partner - default to shipbob for now (will come from DB later)
        partner: (row.partner as 'shipbob' | 'eshipper') || 'shipbob',
        // Classification
        ticketType: row.ticket_type,
        issueType: row.issue_type,
        status: row.status,
        // Assignment
        manager: row.manager,
        // Order/shipment details
        orderId: (row.order_id as string) || null,
        shipmentId: row.shipment_id,
        shipDate: row.ship_date,
        carrier: row.carrier,
        trackingNumber: (row.tracking_number as string) || null,
        // Claim fields
        reshipmentStatus: row.reshipment_status,
        whatToReship: row.what_to_reship,
        reshipmentId: row.reshipment_id,
        compensationRequest: row.compensation_request,
        // Financial
        creditAmount: parseFloat(String(row.credit_amount || 0)),
        currency: row.currency,
        // Work order fields
        workOrderId: row.work_order_id,
        inventoryId: row.inventory_id,
        // Notes
        description: (row.description as string) || null,
        // Only show internal_notes to admin and care users
        internalNotes: (isAdmin || isCareUser) ? row.internal_notes : null,
        // Attachments
        attachments: row.attachments || null,
        // Events timeline
        events: events,
        latestNote: latestEvent?.note || null,
        lastUpdated: latestEvent?.createdAt || row.updated_at,
        // Timestamps
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at,
      }
    })

    // Apply search filter post-mapping
    if (search) {
      mapped = mapped.filter((item) =>
        item.ticketNumber?.toString().includes(search) ||
        item.shipmentId?.toString().toLowerCase().includes(search) ||
        item.orderId?.toLowerCase().includes(search) ||
        item.trackingNumber?.toLowerCase().includes(search) ||
        item.workOrderId?.toString().toLowerCase().includes(search) ||
        item.inventoryId?.toString().toLowerCase().includes(search) ||
        item.description?.toLowerCase().includes(search) ||
        item.clientName?.toLowerCase().includes(search)
      )
    }

    // Adjust counts for search
    const totalCount = search ? mapped.length : (count || 0)
    const paginatedData = search ? mapped.slice(offset, offset + limit) : mapped

    return NextResponse.json({
      data: paginatedData,
      totalCount,
      hasMore: (offset + limit) < totalCount,
    })
  } catch (err) {
    console.error('Care tickets API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/data/care-tickets
 *
 * Create a new care ticket.
 * Thin wrapper around the shared createCareTicket() function.
 * - Admin and Care Admin users can create tickets for any client
 * - Care Team users cannot create tickets (read-only)
 * - Regular users can create tickets for their own clients only
 */
export async function POST(request: NextRequest) {
  try {
    // Get current user
    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const userRole = user.user_metadata?.role as string | undefined
    const isAdmin = userRole === 'admin'
    const isCareAdmin = isCareAdminRole(userRole)
    const isCareTeam = userRole === 'care_team'

    // Care Team users cannot create tickets
    if (isCareTeam) {
      return NextResponse.json(
        { error: 'Care Team users have read-only access' },
        { status: 403 }
      )
    }

    const body = await request.json()

    // Validate required fields
    if (!body.clientId) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
    }
    if (!body.ticketType) {
      return NextResponse.json({ error: 'Ticket type is required' }, { status: 400 })
    }

    // For regular users, verify they have access to the client
    if (!isAdmin && !isCareAdmin) {
      const supabase = createAdminClient()
      const { data: userClients } = await supabase
        .from('user_clients')
        .select('client_id')
        .eq('user_id', user.id)
        .eq('client_id', body.clientId)
        .single()

      if (!userClients) {
        return NextResponse.json(
          { error: 'You do not have access to this client' },
          { status: 403 }
        )
      }
    }

    const supabase = createAdminClient()
    const userName = user.user_metadata?.full_name || user.email || 'System'

    const result = await createCareTicket({
      clientId: body.clientId,
      ticketType: body.ticketType,
      issueType: body.issueType,
      status: body.status,
      manager: body.manager,
      orderId: body.orderId,
      shipmentId: body.shipmentId,
      shipDate: body.shipDate,
      carrier: body.carrier,
      trackingNumber: body.trackingNumber,
      reshipmentStatus: body.reshipmentStatus,
      whatToReship: body.whatToReship,
      reshipmentId: body.reshipmentId,
      compensationRequest: body.compensationRequest,
      creditAmount: body.creditAmount,
      currency: body.currency,
      workOrderId: body.workOrderId,
      inventoryId: body.inventoryId,
      description: body.description,
      internalNotes: body.internalNotes,
      attachments: body.attachments,
      initialNote: body.initialNote,
      carrierConfirmedLoss: body.carrierConfirmedLoss,
      isBrandSubmission: body.isBrandSubmission,
      userId: user.id,
      userName,
      isAdmin,
      isCareAdmin,
    }, supabase)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      ticket: result.ticket,
      autoLinkedCount: result.autoLinkedCount,
    }, { status: 201 })
  } catch (err) {
    console.error('Create care ticket error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
