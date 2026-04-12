import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyLostInTransit } from '@/lib/claims/verify-lost-in-transit'
import { createCareTicket } from '@/lib/claims/create-care-ticket'

/**
 * Cron: Auto-file Lost in Transit claims
 *
 * For each client with auto_file_claims=true:
 * 1. Query eligible shipments from lost_in_transit_checks
 * 2. Re-verify each via TrackingMore
 * 3. File care ticket if still eligible
 * 4. Update status if no longer eligible
 *
 * Schedule: Daily at 4:00 AM EST (0 9 * * * UTC)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    // Get all clients with auto-file enabled (exclude demo clients)
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('id, company_name')
      .eq('auto_file_claims', true)
      .eq('is_demo', false)

    if (clientError) {
      console.error('[AutoFile Cron] Error fetching clients:', clientError)
      return NextResponse.json({ error: clientError.message }, { status: 500 })
    }

    if (!clients || clients.length === 0) {
      console.log('[AutoFile Cron] No clients with auto-file enabled')
      return NextResponse.json({ message: 'No clients with auto-file enabled', filed: 0 })
    }

    let totalFiled = 0
    let totalSkipped = 0
    let totalErrors = 0
    const clientSummaries: string[] = []

    for (const client of clients) {
      // Get eligible shipments for this client
      const { data: eligibleChecks, error: checksError } = await supabase
        .from('lost_in_transit_checks')
        .select('shipment_id, tracking_number, carrier')
        .eq('client_id', client.id)
        .eq('claim_eligibility_status', 'eligible')

      if (checksError) {
        console.error(`[AutoFile Cron] Error fetching eligible checks for ${client.company_name}:`, checksError)
        continue
      }

      if (!eligibleChecks || eligibleChecks.length === 0) {
        continue
      }

      let clientFiled = 0
      let clientSkipped = 0
      let clientErrors = 0

      for (const check of eligibleChecks) {
        try {
          // Re-verify eligibility
          const verification = await verifyLostInTransit(check.shipment_id, supabase)

          if (!verification.eligible) {
            // Update status to reflect reality
            let newStatus: string | null = null
            if (verification.reason?.includes('delivered')) {
              newStatus = 'at_risk'
            } else if (verification.reason?.includes('returned') || verification.reason?.includes('returning')) {
              newStatus = 'returned_to_sender'
            } else if (verification.daysRemaining && verification.daysRemaining > 0) {
              newStatus = 'at_risk'
            }

            if (newStatus) {
              await supabase
                .from('lost_in_transit_checks')
                .update({ claim_eligibility_status: newStatus })
                .eq('shipment_id', check.shipment_id)
            }

            clientSkipped++
            continue
          }

          // Get shipment details for the care ticket
          const { data: shipment } = await supabase
            .from('shipments')
            .select('shipment_id, tracking_id, carrier, event_labeled, shipbob_order_id')
            .eq('shipment_id', check.shipment_id)
            .single()

          // File the claim
          const result = await createCareTicket({
            clientId: client.id,
            ticketType: 'Claim',
            issueType: 'Loss',
            status: 'Under Review',
            shipmentId: check.shipment_id,
            orderId: shipment?.shipbob_order_id || null,
            carrier: shipment?.carrier || check.carrier || null,
            trackingNumber: shipment?.tracking_id || check.tracking_number || null,
            shipDate: shipment?.event_labeled || null,
            description: 'Auto-filed by Delivery IQ (daily cron)',
            carrierConfirmedLoss: false,
            // Cron has no authenticated user — created_by is nullable UUID
            userId: null,
            userName: 'Delivery IQ Auto-File',
            isAdmin: false,
            isCareAdmin: false,
          }, supabase)

          if (result.success) {
            clientFiled++
          } else {
            console.warn(`[AutoFile Cron] Failed to file for ${check.shipment_id}:`, result.error)
            clientErrors++
          }
        } catch (err) {
          console.error(`[AutoFile Cron] Error processing ${check.shipment_id}:`, err)
          clientErrors++
        }
      }

      totalFiled += clientFiled
      totalSkipped += clientSkipped
      totalErrors += clientErrors

      const summary = `${client.company_name}: ${clientFiled}/${eligibleChecks.length} filed, ${clientSkipped} skipped, ${clientErrors} errors`
      clientSummaries.push(summary)
      console.log(`[AutoFile Cron] ${summary}`)
    }

    console.log(`[AutoFile Cron] Complete — ${totalFiled} filed, ${totalSkipped} skipped, ${totalErrors} errors across ${clients.length} client(s)`)

    return NextResponse.json({
      message: 'Auto-file cron complete',
      filed: totalFiled,
      skipped: totalSkipped,
      errors: totalErrors,
      clients: clientSummaries,
    })
  } catch (err) {
    console.error('[AutoFile Cron] Fatal error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
