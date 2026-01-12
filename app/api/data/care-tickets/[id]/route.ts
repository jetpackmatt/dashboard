import {
  createAdminClient,
  isCareAdminRole,
} from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/care-tickets/[id]
 *
 * Fetch a single care ticket by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get current user
    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const userRole = user.user_metadata?.role as string | undefined
    const isAdmin = userRole === 'admin'
    const isCareUser = userRole === 'care_admin' || userRole === 'care_team'

    const supabase = createAdminClient()

    // Fetch the ticket with client info
    const { data: ticket, error } = await supabase
      .from('care_tickets')
      .select(`
        *,
        clients(company_name)
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      console.error('Error fetching care ticket:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // For regular users, verify they have access to this client
    if (!isAdmin && !isCareUser) {
      const { data: userClient } = await supabase
        .from('user_clients')
        .select('client_id')
        .eq('user_id', user.id)
        .eq('client_id', ticket.client_id)
        .single()

      if (!userClient) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Map to response format
    const clientData = ticket.clients as Record<string, unknown> | null
    const events = (ticket.events as Array<Record<string, unknown>>) || []
    const latestEvent = events[0] || null

    const response = {
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      clientId: ticket.client_id,
      clientName: clientData?.company_name || 'Unknown',
      ticketType: ticket.ticket_type,
      issueType: ticket.issue_type,
      status: ticket.status,
      manager: ticket.manager,
      orderId: ticket.order_id,
      shipmentId: ticket.shipment_id,
      shipDate: ticket.ship_date,
      carrier: ticket.carrier,
      trackingNumber: ticket.tracking_number,
      reshipmentStatus: ticket.reshipment_status,
      whatToReship: ticket.what_to_reship,
      reshipmentId: ticket.reshipment_id,
      compensationRequest: ticket.compensation_request,
      creditAmount: parseFloat(ticket.credit_amount || '0'),
      currency: ticket.currency,
      workOrderId: ticket.work_order_id,
      inventoryId: ticket.inventory_id,
      description: ticket.description,
      internalNotes: (isAdmin || isCareUser) ? ticket.internal_notes : null,
      // Events timeline
      events: events,
      latestNote: latestEvent?.note || null,
      lastUpdated: latestEvent?.createdAt || ticket.updated_at,
      // Timestamps
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      resolvedAt: ticket.resolved_at,
    }

    return NextResponse.json({ data: response })
  } catch (err) {
    console.error('Get care ticket error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/data/care-tickets/[id]
 *
 * Update a care ticket.
 * - Admin and Care Admin can update any ticket
 * - Care Team users cannot update (read-only)
 * - Regular users can only update tickets for their own clients
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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

    // Care Team users can only add internal notes, not update other ticket fields
    // We'll check this further down when processing the request body

    const supabase = createAdminClient()

    // Get existing ticket to check access and get current events/internal_notes
    const { data: existingTicket, error: fetchError } = await supabase
      .from('care_tickets')
      .select('client_id, status, events, internal_notes')
      .eq('id', id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    // For regular users, verify they have access to this client
    if (!isAdmin && !isCareAdmin) {
      const { data: userClient } = await supabase
        .from('user_clients')
        .select('client_id')
        .eq('user_id', user.id)
        .eq('client_id', existingTicket.client_id)
        .single()

      if (!userClient) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const body = await request.json()
    const {
      ticketType,
      issueType,
      status,
      manager,
      orderId,
      shipmentId,
      shipDate,
      carrier,
      trackingNumber,
      reshipmentStatus,
      whatToReship,
      reshipmentId,
      compensationRequest,
      creditAmount,
      currency,
      workOrderId,
      inventoryId,
      description,
      internalNote, // New internal note to add to timeline (singular - adds to array)
      eventNote, // Optional note for the event being created
    } = body

    // Care Team users can only add internal notes - reject if trying to update other fields
    if (isCareTeam) {
      const hasOtherFields = ticketType !== undefined || issueType !== undefined ||
        status !== undefined || manager !== undefined || orderId !== undefined ||
        shipmentId !== undefined || shipDate !== undefined || carrier !== undefined ||
        trackingNumber !== undefined || reshipmentStatus !== undefined ||
        whatToReship !== undefined || reshipmentId !== undefined ||
        compensationRequest !== undefined || creditAmount !== undefined ||
        currency !== undefined || workOrderId !== undefined || inventoryId !== undefined ||
        description !== undefined || eventNote !== undefined

      if (hasOtherFields) {
        return NextResponse.json(
          { error: 'Care Team users can only add internal notes' },
          { status: 403 }
        )
      }
    }

    // Build update object (only include fields that were provided)
    const updateData: Record<string, unknown> = {}

    if (ticketType !== undefined) updateData.ticket_type = ticketType
    if (issueType !== undefined) updateData.issue_type = issueType
    if (status !== undefined) {
      updateData.status = status
      // Set resolved_at when status changes to Resolved
      if (status === 'Resolved') {
        updateData.resolved_at = new Date().toISOString()
      } else if (existingTicket && status !== 'Resolved') {
        // Clear resolved_at if status changes from Resolved to something else
        updateData.resolved_at = null
      }
    }
    if (manager !== undefined) updateData.manager = manager
    if (orderId !== undefined) updateData.order_id = orderId
    if (shipmentId !== undefined) updateData.shipment_id = shipmentId
    if (shipDate !== undefined) updateData.ship_date = shipDate
    if (carrier !== undefined) updateData.carrier = carrier
    if (trackingNumber !== undefined) updateData.tracking_number = trackingNumber
    if (reshipmentStatus !== undefined) updateData.reshipment_status = reshipmentStatus
    if (whatToReship !== undefined) updateData.what_to_reship = whatToReship
    if (reshipmentId !== undefined) updateData.reshipment_id = reshipmentId
    if (compensationRequest !== undefined) updateData.compensation_request = compensationRequest
    if (creditAmount !== undefined) updateData.credit_amount = creditAmount
    if (currency !== undefined) updateData.currency = currency
    if (workOrderId !== undefined) updateData.work_order_id = workOrderId
    if (inventoryId !== undefined) updateData.inventory_id = inventoryId
    if (description !== undefined) updateData.description = description

    // Handle internal notes timeline - admin, care_admin, and care_team can all add notes
    if (internalNote && (isAdmin || isCareAdmin || isCareTeam)) {
      const currentInternalNotes = (existingTicket.internal_notes as Array<Record<string, unknown>>) || []
      const userName = user.user_metadata?.full_name || user.email || 'Unknown'

      const newInternalNote = {
        note: internalNote,
        createdAt: new Date().toISOString(),
        createdBy: userName,
      }

      // Prepend new note (most recent first)
      updateData.internal_notes = [newInternalNote, ...currentInternalNotes]
    }

    if (Object.keys(updateData).length === 0 && !eventNote) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Create event entry for the timeline
    // Events are created when: status changes, or an eventNote is provided
    const newStatus = status !== undefined ? status : existingTicket.status
    const statusChanged = status !== undefined && status !== existingTicket.status
    const shouldCreateEvent = statusChanged || eventNote

    if (shouldCreateEvent) {
      const currentEvents = (existingTicket.events as Array<Record<string, unknown>>) || []
      const userName = user.user_metadata?.full_name || user.email || 'Unknown'

      const newEvent = {
        status: newStatus,
        note: eventNote || (statusChanged ? `Status changed to ${newStatus}` : ''),
        createdAt: new Date().toISOString(),
        createdBy: userName,
      }

      // Prepend new event (most recent first)
      updateData.events = [newEvent, ...currentEvents]
    }

    // Perform update
    const { data: updatedTicket, error: updateError } = await supabase
      .from('care_tickets')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating care ticket:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      ticket: updatedTicket,
    })
  } catch (err) {
    console.error('Update care ticket error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/data/care-tickets/[id]
 *
 * Delete a care ticket.
 * - Only Admin users can delete tickets
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get current user
    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const userRole = user.user_metadata?.role as string | undefined
    const isAdmin = userRole === 'admin'

    // Only admin users can delete tickets
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Only administrators can delete tickets' },
        { status: 403 }
      )
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('care_tickets')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting care ticket:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete care ticket error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
