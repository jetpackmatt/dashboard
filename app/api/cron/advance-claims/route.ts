import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Cron endpoint to advance claims and sync claim statuses
 *
 * Part 1: Advances claims from "Under Review" to "Credit Requested"
 * - Creates the appearance of a review process
 * - Automatically advances claims 15 minutes after submission
 *
 * Part 2: Syncs care ticket status to lost_in_transit_checks
 * - When care ticket is "Resolved" → claim_eligibility_status = 'approved'
 * - When care ticket is "Credit Denied" → claim_eligibility_status = 'denied'
 * - This ensures archived filter shows resolved claims
 *
 * Runs every 5 minutes (* /5 * * * *)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel automatically includes this header)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Allow access if:
  // 1. CRON_SECRET not set (development)
  // 2. Authorization header matches
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron AdvanceClaims] Starting claim advancement...')
  const startTime = Date.now()

  try {
    const supabase = createAdminClient()

    // Find claims that are Under Review and were created 15+ minutes ago
    const fifteenMinutesAgo = new Date()
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15)

    const { data: claimsToAdvance, error: fetchError } = await supabase
      .from('care_tickets')
      .select('id, ticket_number, events, created_at')
      .eq('ticket_type', 'Claim')
      .eq('status', 'Under Review')
      .lte('created_at', fifteenMinutesAgo.toISOString())

    if (fetchError) {
      console.error('[Cron AdvanceClaims] Error fetching claims:', fetchError.message)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    let advanced = 0
    let errors = 0

    if (!claimsToAdvance || claimsToAdvance.length === 0) {
      console.log('[Cron AdvanceClaims] No claims to advance')
    } else {
      console.log(`[Cron AdvanceClaims] Found ${claimsToAdvance.length} claims to advance`)

      for (const claim of claimsToAdvance) {
        const events = (claim.events as Array<{ status: string; note: string; createdAt: string; createdBy: string }>) || []

        // Add Credit Requested event
        const creditRequestedEvent = {
          status: 'Credit Requested',
          note: 'Credit request has been sent to the warehouse team for review.',
          createdAt: new Date().toISOString(),
          createdBy: 'System',
        }

        // Prepend to events array (newest first)
        const updatedEvents = [creditRequestedEvent, ...events]

        const { error: updateError } = await supabase
          .from('care_tickets')
          .update({
            status: 'Credit Requested',
            events: updatedEvents,
            updated_at: new Date().toISOString(),
          })
          .eq('id', claim.id)

        if (updateError) {
          console.error(`[Cron AdvanceClaims] Error updating ticket #${claim.ticket_number}:`, updateError.message)
          errors++
        } else {
          console.log(`[Cron AdvanceClaims] Advanced ticket #${claim.ticket_number} to Credit Requested`)
          advanced++
        }
      }
    }

    // ========================================
    // Part 2: Sync care ticket status to lost_in_transit_checks
    // ========================================
    console.log('[Cron AdvanceClaims] Starting claim status sync to lost_in_transit_checks...')

    let synced = 0
    let syncErrors = 0

    // Find care tickets that are Resolved or Credit Denied but their lost_in_transit_checks
    // record still has claim_eligibility_status = 'claim_filed'
    const { data: ticketsToSync, error: syncFetchError } = await supabase
      .from('care_tickets')
      .select('id, ticket_number, shipment_id, status')
      .eq('ticket_type', 'Claim')
      .in('status', ['Resolved', 'Credit Denied'])

    if (syncFetchError) {
      console.error('[Cron AdvanceClaims] Error fetching tickets to sync:', syncFetchError.message)
    } else if (ticketsToSync && ticketsToSync.length > 0) {
      console.log(`[Cron AdvanceClaims] Found ${ticketsToSync.length} resolved/denied tickets to check`)

      for (const ticket of ticketsToSync) {
        if (!ticket.shipment_id) continue

        // Determine the new status
        const newStatus = ticket.status === 'Resolved' ? 'approved' : 'denied'

        // Update the lost_in_transit_checks record if it hasn't already been synced
        // Include at_risk/eligible in case claim was filed but status wasn't updated
        const { data: updated, error: updateError } = await supabase
          .from('lost_in_transit_checks')
          .update({ claim_eligibility_status: newStatus })
          .eq('shipment_id', ticket.shipment_id)
          .in('claim_eligibility_status', ['at_risk', 'eligible', 'claim_filed'])
          .select('id')

        if (updateError) {
          console.error(`[Cron AdvanceClaims] Error syncing ticket #${ticket.ticket_number}:`, updateError.message)
          syncErrors++
        } else if (updated && updated.length > 0) {
          console.log(`[Cron AdvanceClaims] Synced ticket #${ticket.ticket_number} → ${newStatus}`)
          synced++
        }
      }
    }

    const duration = Date.now() - startTime
    console.log(`[Cron AdvanceClaims] Completed in ${duration}ms: ${advanced} advanced, ${synced} synced, ${errors + syncErrors} errors`)

    return NextResponse.json({
      success: errors === 0 && syncErrors === 0,
      duration: `${duration}ms`,
      claimsAdvanced: advanced,
      claimsSynced: synced,
      errors: errors + syncErrors,
    })
  } catch (error) {
    console.error('[Cron AdvanceClaims] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      },
      { status: 500 }
    )
  }
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
