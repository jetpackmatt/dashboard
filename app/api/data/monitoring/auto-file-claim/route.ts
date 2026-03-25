import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyLostInTransit } from '@/lib/claims/verify-lost-in-transit'
import { createCareTicket } from '@/lib/claims/create-care-ticket'

/**
 * POST /api/data/monitoring/auto-file-claim
 *
 * Files a single Lost in Transit claim for an eligible shipment.
 * Used by both the client-side batch loop and the daily auto-file cron.
 *
 * Body: { shipmentId, clientId }
 *
 * Returns:
 * - { success: true, shipmentId, ticketNumber } on successful filing
 * - { success: false, reason, shipmentId, newStatus? } if ineligible or error
 */
export async function POST(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const body = await request.json()
  const { shipmentId, clientId } = body

  if (!shipmentId || !clientId) {
    return NextResponse.json(
      { error: 'shipmentId and clientId are required' },
      { status: 400 }
    )
  }

  let verifiedClientId: string | null
  try {
    const access = await verifyClientAccess(clientId)
    verifiedClientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  if (!verifiedClientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
  }

  // Get current user for ticket creation
  const authSupabase = await createClient()
  const { data: { user }, error: authError } = await authSupabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    // Verify shipment belongs to the requested client (defense-in-depth)
    const { data: shipmentOwner } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', shipmentId)
      .single()

    if (!shipmentOwner || shipmentOwner.client_id !== verifiedClientId) {
      return NextResponse.json({
        success: false,
        shipmentId,
        reason: 'Shipment does not belong to this client',
      }, { status: 403 })
    }

    // Step 1: Re-verify eligibility via TrackingMore
    const verification = await verifyLostInTransit(shipmentId, supabase)

    if (!verification.eligible) {
      // Update the LIT check status to reflect the real state
      let newStatus: string | null = null

      if (verification.reason?.includes('delivered')) {
        // Package was delivered — move back to at_risk (will be cleaned up by cron)
        newStatus = 'at_risk'
      } else if (verification.reason?.includes('returned') || verification.reason?.includes('returning')) {
        newStatus = 'returned_to_sender'
      } else if (verification.daysRemaining && verification.daysRemaining > 0) {
        // Not yet eligible — move back to at_risk
        newStatus = 'at_risk'
      }

      if (newStatus) {
        await supabase
          .from('lost_in_transit_checks')
          .update({ claim_eligibility_status: newStatus })
          .eq('shipment_id', shipmentId)
      }

      return NextResponse.json({
        success: false,
        shipmentId,
        reason: verification.reason || 'Not eligible for Lost in Transit claim',
        newStatus,
      })
    }

    // Step 2: Get shipment details for the care ticket
    const { data: shipment } = await supabase
      .from('shipments')
      .select('shipment_id, tracking_id, carrier, event_labeled, shipbob_order_id')
      .eq('shipment_id', shipmentId)
      .single()

    // Step 3: File the claim using shared createCareTicket
    // Pass status: "Under Review" explicitly — same as ClaimSubmissionDialog does
    // for brand users. This ensures the advance-claims cron picks it up.
    const userName = user.user_metadata?.full_name || user.email || 'System'
    const userRole = user.user_metadata?.role as string | undefined

    const result = await createCareTicket({
      clientId: verifiedClientId,
      ticketType: 'Claim',
      issueType: 'Loss',
      status: 'Under Review',
      shipmentId,
      orderId: shipment?.shipbob_order_id || null,
      carrier: shipment?.carrier || null,
      trackingNumber: shipment?.tracking_id || null,
      shipDate: shipment?.event_labeled || null,
      description: 'Auto-filed by Delivery IQ',
      carrierConfirmedLoss: false,
      userId: user.id,
      userName,
      isAdmin: userRole === 'admin',
      isCareAdmin: false,
    }, supabase)

    if (!result.success) {
      return NextResponse.json({
        success: false,
        shipmentId,
        reason: result.error || 'Failed to create care ticket',
      })
    }

    const ticket = result.ticket as Record<string, unknown>

    return NextResponse.json({
      success: true,
      shipmentId,
      ticketNumber: ticket?.ticket_number,
    })
  } catch (err) {
    console.error('[AutoFile] Error filing claim for shipment:', shipmentId, err)
    return NextResponse.json({
      success: false,
      shipmentId,
      reason: 'Internal server error',
    }, { status: 500 })
  }
}
