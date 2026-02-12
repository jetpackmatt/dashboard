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
      .select('client_id, status, events, internal_notes, credit_amount, ticket_type')
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
      clientId, // Attribute ticket to a client (admin/care_admin only)
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
        description !== undefined || eventNote !== undefined || clientId !== undefined

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
    if (clientId !== undefined && (isAdmin || isCareAdmin)) updateData.client_id = clientId

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

    // Create attribution event when client_id is set
    if (clientId !== undefined && (isAdmin || isCareAdmin)) {
      const currentEvents = (existingTicket.events as Array<Record<string, unknown>>) || []
      const userName = user.user_metadata?.full_name || user.email || 'Unknown'

      // Look up client name for the event
      let clientName = 'Unknown'
      const { data: clientData } = await supabase
        .from('clients')
        .select('company_name')
        .eq('id', clientId)
        .single()
      if (clientData) clientName = clientData.company_name

      const attributionEvent = {
        status: existingTicket.status,
        note: `Attributed to ${clientName}`,
        createdAt: new Date().toISOString(),
        createdBy: userName,
      }
      // If events are already being updated (status change below), we'll prepend there
      // Otherwise prepend to current events
      updateData.events = [attributionEvent, ...currentEvents]
    }

    // Create event entry for the timeline
    // Events are created when: status changes, or an eventNote is provided
    const newStatus = status !== undefined ? status : existingTicket.status
    const statusChanged = status !== undefined && status !== existingTicket.status
    const shouldCreateEvent = statusChanged || eventNote

    if (shouldCreateEvent) {
      // Use already-updated events (e.g. from attribution above) if available, else use existing
      const currentEvents = (updateData.events as Array<Record<string, unknown>>) || (existingTicket.events as Array<Record<string, unknown>>) || []
      const userName = user.user_metadata?.full_name || user.email || 'Unknown'

      // Build contextual default note based on status
      let defaultNote = ''
      if (statusChanged) {
        const creditAmt = parseFloat(existingTicket.credit_amount || '0')
        const hasCreditAmount = creditAmt > 0
        const creditStr = hasCreditAmount ? `$${creditAmt.toFixed(2)}` : null
        const isClaim = existingTicket.ticket_type === 'Claim'

        switch (newStatus) {
          case 'Under Review':
            defaultNote = 'The Jetpack team is reviewing this request.'
            break
          case 'Credit Requested':
            defaultNote = 'We have sent a credit request to the warehouse team.'
            break
          case 'Credit Approved':
            defaultNote = creditStr
              ? `A credit of ${creditStr} has been approved and will appear on your next invoice.`
              : 'A credit has been approved and will appear on your next invoice.'
            break
          case 'Credit Denied':
            defaultNote = 'The credit request was denied. Reach out on Slack for more details.'
            break
          case 'Input Required':
            defaultNote = 'We need more information to proceed. Please reach out via Slack or email.'
            break
          case 'Resolved':
            if (isClaim) {
              defaultNote = creditStr
                ? `Your credit of ${creditStr} has been applied to your account.`
                : 'A credit has been applied to your account.'
            } else {
              defaultNote = 'This ticket has been marked as resolved.'
            }
            break
          default:
            defaultNote = `Status changed to ${newStatus}`
        }
      }

      const newEvent = {
        status: newStatus,
        note: eventNote || defaultNote,
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
 * - Supports soft delete (archive) or permanent delete
 * - Query param: ?permanent=true for hard delete (also removes files)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const permanent = searchParams.get('permanent') === 'true'

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

    // First, get the ticket to access attachments and shipment_id
    const { data: ticket, error: fetchError } = await supabase
      .from('care_tickets')
      .select('attachments, shipment_id, ticket_type')
      .eq('id', id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (permanent) {
      // PERMANENT DELETE: Remove files, reset related records, delete ticket

      // 1. Delete files from Supabase Storage
      const attachments = ticket.attachments as Array<{ path?: string }> | null
      if (attachments && attachments.length > 0) {
        const paths = attachments
          .filter(att => att.path)
          .map(att => att.path as string)

        if (paths.length > 0) {
          const { error: storageError } = await supabase.storage
            .from('claim-attachments')
            .remove(paths)

          if (storageError) {
            console.warn('Warning: Failed to delete some attachments:', storageError.message)
            // Continue with ticket deletion even if file deletion fails
          }
        }
      }

      // 2. Reset lost_in_transit_checks if this was a claim
      if (ticket.ticket_type === 'Claim' && ticket.shipment_id) {
        await supabase
          .from('lost_in_transit_checks')
          .update({ claim_eligibility_status: 'eligible' })
          .eq('shipment_id', ticket.shipment_id)
          .in('claim_eligibility_status', ['claim_filed', 'approved', 'denied'])
      }

      // 3. Delete the ticket
      const { error: deleteError } = await supabase
        .from('care_tickets')
        .delete()
        .eq('id', id)

      if (deleteError) {
        console.error('Error permanently deleting care ticket:', deleteError)
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, action: 'permanently_deleted' })
    } else {
      // SOFT DELETE: Set deleted_at timestamp
      const userName = user.user_metadata?.full_name || user.email || 'Unknown'

      const { error: updateError } = await supabase
        .from('care_tickets')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userName,
        })
        .eq('id', id)

      if (updateError) {
        console.error('Error archiving care ticket:', updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, action: 'archived' })
    }
  } catch (err) {
    console.error('Delete care ticket error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
