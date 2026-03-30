/**
 * Shared care ticket creation logic.
 *
 * Extracted from app/api/data/care-tickets/route.ts POST handler
 * so that both manual claim submission and auto-file use the same code path.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { sendSlackAlert } from '@/lib/slack'

export interface CreateCareTicketParams {
  clientId: string
  ticketType: string
  issueType?: string | null
  status?: string | null
  manager?: string | null
  orderId?: string | null
  shipmentId?: string | null
  shipDate?: string | null
  carrier?: string | null
  trackingNumber?: string | null
  reshipmentStatus?: string | null
  whatToReship?: string | null
  reshipmentId?: string | null
  compensationRequest?: string | null
  creditAmount?: number
  currency?: string
  workOrderId?: string | null
  inventoryId?: string | null
  description?: string | null
  internalNotes?: string | null
  attachments?: unknown[]
  initialNote?: string | null
  carrierConfirmedLoss?: boolean
  isBrandSubmission?: boolean
  // Caller context
  userId: string | null
  userName: string
  isAdmin: boolean
  isCareAdmin: boolean
}

export interface CreateCareTicketResult {
  success: boolean
  error?: string
  ticket?: Record<string, unknown>
  autoLinkedCount?: number
}

/**
 * Create a care ticket with all associated side effects:
 * - RETURNING guard (blocks claims for returning shipments)
 * - Duplicate claim check is NOT done here — caller should check if needed
 * - Initial events (Ticket Created + optional Under Review)
 * - Auto-link credit transactions
 * - Slack alert for Address Change tickets
 * - Update lost_in_transit_checks status to claim_filed
 */
export async function createCareTicket(
  params: CreateCareTicketParams,
  supabase: SupabaseClient
): Promise<CreateCareTicketResult> {
  const {
    clientId,
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
    internalNotes,
    attachments,
    initialNote,
    carrierConfirmedLoss,
    isBrandSubmission,
    userId,
    userName,
    isAdmin,
    isCareAdmin,
  } = params

  // Block claims for RETURNING shipments
  if (ticketType === 'Claim' && shipmentId) {
    const { data: litCheck } = await supabase
      .from('lost_in_transit_checks')
      .select('watch_reason, claim_eligibility_status')
      .eq('shipment_id', shipmentId)
      .single()
    if (litCheck?.watch_reason === 'RETURNING' || litCheck?.claim_eligibility_status === 'returned_to_sender') {
      return {
        success: false,
        error: 'Cannot file a claim for a shipment that is being returned to sender',
      }
    }
  }

  // Check for existing Loss claim on this shipment (duplicate prevention)
  if (ticketType === 'Claim' && issueType === 'Loss' && shipmentId) {
    const { data: existingClaim } = await supabase
      .from('care_tickets')
      .select('id, ticket_number, status')
      .eq('shipment_id', shipmentId)
      .eq('issue_type', 'Loss')
      .is('deleted_at', null)
      .limit(1)
      .single()

    if (existingClaim) {
      return {
        success: false,
        error: `A Loss claim already exists for this shipment (Ticket #${existingClaim.ticket_number}, status: ${existingClaim.status})`,
      }
    }
  }

  // Build initial events (newest first)
  const initialEvents: Array<{
    status: string
    note: string
    createdAt: string
    createdBy: string
  }> = []

  // For admin/care created tickets: auto-advance to Under Review
  if (isAdmin || isCareAdmin) {
    initialEvents.push({
      status: 'Under Review',
      note: initialNote || (ticketType === 'Claim'
        ? 'Jetpack team is reviewing your claim request.'
        : 'We are reviewing this request.'),
      createdAt: new Date().toISOString(),
      createdBy: userName,
    })
  }

  // All tickets start with "Ticket Created" as the base event
  initialEvents.push({
    status: 'Ticket Created',
    note: 'Awaiting review by a Jetpack team member.',
    createdAt: new Date().toISOString(),
    createdBy: 'System',
  })

  // Ticket status = topmost event status
  const ticketStatus = status || initialEvents[0].status

  const { data: ticket, error } = await supabase
    .from('care_tickets')
    .insert({
      client_id: clientId,
      ticket_type: ticketType,
      issue_type: issueType || null,
      status: ticketStatus,
      manager: manager || null,
      created_by: userId,
      order_id: orderId || null,
      shipment_id: shipmentId || null,
      ship_date: shipDate || null,
      carrier: carrier || null,
      tracking_number: trackingNumber || null,
      reshipment_status: reshipmentStatus || null,
      what_to_reship: whatToReship || null,
      reshipment_id: reshipmentId || null,
      compensation_request: compensationRequest || null,
      credit_amount: creditAmount || 0,
      currency: currency || 'USD',
      work_order_id: workOrderId || null,
      inventory_id: inventoryId || null,
      description: description || null,
      internal_notes: internalNotes || null,
      attachments: attachments || [],
      events: initialEvents,
      carrier_confirmed_loss: carrierConfirmedLoss || false,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating care ticket:', error)
    return { success: false, error: error.message }
  }

  // Auto-link unlinked credit transactions for the same shipment + client
  let autoLinkedCount = 0
  if (ticket.shipment_id && ticket.client_id) {
    const { data: linkedTxs, error: linkErr } = await supabase
      .from('transactions')
      .update({ care_ticket_id: ticket.id })
      .eq('fee_type', 'Credit')
      .is('care_ticket_id', null)
      .eq('client_id', ticket.client_id)
      .eq('reference_id', ticket.shipment_id)
      .eq('is_voided', false)
      .select('transaction_id')

    if (linkErr) {
      console.error('Auto-link credit transactions error:', linkErr)
    } else {
      autoLinkedCount = linkedTxs?.length || 0
      if (autoLinkedCount > 0) {
        console.log(`Auto-linked ${autoLinkedCount} credit transaction(s) to ticket #${ticket.ticket_number}`)
      }
    }
  }

  // Update lost_in_transit_checks status to claim_filed
  if (shipmentId && issueType === 'Loss') {
    const { error: litUpdateErr } = await supabase
      .from('lost_in_transit_checks')
      .update({ claim_eligibility_status: 'claim_filed' })
      .eq('shipment_id', shipmentId)

    if (litUpdateErr) {
      console.error('Error updating LIT check status to claim_filed:', litUpdateErr)
    }
  }

  // Update shipment's reshipment_id if provided (LIT claims with known replacement)
  if (shipmentId && reshipmentId) {
    const { error: reshipErr } = await supabase
      .from('shipments')
      .update({ reshipment_id: reshipmentId })
      .eq('shipment_id', shipmentId)
      .is('reshipment_id', null)  // Don't overwrite existing

    if (reshipErr) {
      console.error('Error updating shipment reshipment_id:', reshipErr)
    }
  }

  // Slack alert: brand users submitting Address Change tickets
  if (isBrandSubmission && ticketType === 'Address Change') {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('company_name')
      .eq('id', clientId)
      .single()
    const brandName = clientRow?.company_name || 'Unknown Brand'

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.shipwithjetpack.com'
    const ticketUrl = `${baseUrl}/dashboard/care?ticket=${ticket.ticket_number}`

    sendSlackAlert(
      `📦 *Address Change Request* — <${ticketUrl}|Ticket #${ticket.ticket_number}>\n` +
      `Brand: ${brandName}\n` +
      `Shipment: ${shipmentId || 'N/A'}\n` +
      `Submitted by: ${userName}`
    )
  }

  return {
    success: true,
    ticket,
    autoLinkedCount,
  }
}
