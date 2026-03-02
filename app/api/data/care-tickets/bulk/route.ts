import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/data/care-tickets/bulk
 *
 * Bulk operations on care tickets.
 * Body: { action: 'archive' | 'delete' | 'resolve', ticketIds: string[] }
 *
 * Permissions:
 *   archive:  admin, care_admin, brand users (own tickets only)
 *   delete:   admin, care_admin only
 *   resolve:  admin, care_admin only
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
    const isCareAdmin = userRole === 'care_admin'
    const isCareTeam = userRole === 'care_team'

    const body = await request.json()
    const { action, ticketIds } = body as { action: string; ticketIds: string[] }

    // Validate input
    if (!action || !['archive', 'delete', 'resolve'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json({ error: 'No tickets selected' }, { status: 400 })
    }

    if (ticketIds.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 tickets per bulk operation' }, { status: 400 })
    }

    // Permission checks
    if (action === 'delete' && !isAdmin && !isCareAdmin) {
      return NextResponse.json(
        { error: 'Only administrators can permanently delete tickets' },
        { status: 403 }
      )
    }

    if (action === 'resolve' && !isAdmin && !isCareAdmin) {
      return NextResponse.json(
        { error: 'Only administrators can bulk resolve tickets' },
        { status: 403 }
      )
    }

    if (isCareTeam) {
      return NextResponse.json(
        { error: 'Care team members cannot perform bulk operations' },
        { status: 403 }
      )
    }

    const supabase = createAdminClient()

    // For brand users, verify they have access to ALL selected tickets
    if (!isAdmin && !isCareAdmin) {
      // Get user's client IDs
      const { data: userClients } = await supabase
        .from('user_clients')
        .select('client_id')
        .eq('user_id', user.id)

      if (!userClients || userClients.length === 0) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      const userClientIds = new Set(userClients.map((uc: { client_id: string }) => uc.client_id))

      // Fetch the client_id for each selected ticket
      const { data: tickets } = await supabase
        .from('care_tickets')
        .select('id, client_id')
        .in('id', ticketIds)

      if (!tickets) {
        return NextResponse.json({ error: 'Failed to verify ticket access' }, { status: 500 })
      }

      // Verify user has access to every ticket's client
      const unauthorized = tickets.filter((t: { id: string; client_id: string }) => !userClientIds.has(t.client_id))
      if (unauthorized.length > 0) {
        return NextResponse.json({ error: 'Access denied to one or more tickets' }, { status: 403 })
      }
    }

    const userName = user.user_metadata?.full_name || user.email || 'Unknown'
    let successCount = 0
    let errorCount = 0

    if (action === 'archive') {
      // Soft delete: set deleted_at
      const { error: updateError, count } = await supabase
        .from('care_tickets')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userName,
        })
        .in('id', ticketIds)

      if (updateError) {
        console.error('Bulk archive error:', updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      successCount = count ?? ticketIds.length
    } else if (action === 'delete') {
      // Permanent delete: remove files, reset LIT checks, delete tickets
      // First, get all tickets to handle cleanup
      const { data: tickets } = await supabase
        .from('care_tickets')
        .select('id, attachments, shipment_id, ticket_type')
        .in('id', ticketIds)

      if (tickets) {
        for (const ticket of tickets) {
          try {
            // Delete storage files
            const attachments = ticket.attachments as Array<{ path?: string }> | null
            if (attachments && attachments.length > 0) {
              const paths = attachments
                .filter((att: { path?: string }) => att.path)
                .map((att: { path?: string }) => att.path as string)

              if (paths.length > 0) {
                await supabase.storage
                  .from('claim-attachments')
                  .remove(paths)
              }
            }

            // Reset LIT checks if this was a claim
            if (ticket.ticket_type === 'Claim' && ticket.shipment_id) {
              await supabase
                .from('lost_in_transit_checks')
                .update({ claim_eligibility_status: 'eligible' })
                .eq('shipment_id', ticket.shipment_id)
                .in('claim_eligibility_status', ['claim_filed', 'approved', 'denied'])
            }

            successCount++
          } catch (err) {
            console.error(`Bulk delete cleanup error for ticket ${ticket.id}:`, err)
            errorCount++
          }
        }

        // Now delete all the tickets
        const { error: deleteError } = await supabase
          .from('care_tickets')
          .delete()
          .in('id', ticketIds)

        if (deleteError) {
          console.error('Bulk delete error:', deleteError)
          return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }
      }
    } else if (action === 'resolve') {
      // Mark as Resolved: update status and add timeline event
      // Fetch current tickets to build events
      const { data: tickets } = await supabase
        .from('care_tickets')
        .select('id, status, events')
        .in('id', ticketIds)

      if (tickets) {
        for (const ticket of tickets) {
          if (ticket.status === 'Resolved') {
            // Already resolved, skip
            successCount++
            continue
          }

          try {
            const currentEvents = (ticket.events as Array<Record<string, unknown>>) || []
            const newEvent = {
              status: 'Resolved',
              note: 'This ticket has been marked as resolved.',
              createdAt: new Date().toISOString(),
              createdBy: userName,
            }

            await supabase
              .from('care_tickets')
              .update({
                status: 'Resolved',
                resolved_at: new Date().toISOString(),
                events: [newEvent, ...currentEvents],
              })
              .eq('id', ticket.id)

            successCount++
          } catch (err) {
            console.error(`Bulk resolve error for ticket ${ticket.id}:`, err)
            errorCount++
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      action,
      successCount,
      errorCount,
      totalRequested: ticketIds.length,
    })
  } catch (err) {
    console.error('Bulk care ticket error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
