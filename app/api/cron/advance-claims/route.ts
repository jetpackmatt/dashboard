import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendClaimEmail, fetchAttachmentBuffers } from '@/lib/email/client'
import { generateClaimEmail, IssueType, ReshipmentStatus } from '@/lib/email/templates'
import { excludeDemoClients } from '@/lib/demo/exclusion'
import { sendSlackAlert } from '@/lib/slack'

// Resend paid tier: 5 emails/sec. We throttle to ~3/sec (300ms between sends)
// to stay comfortably under the limit even if multiple crons overlap or if
// Resend's rate-limit clock isn't perfectly aligned with ours.
const THROTTLE_MS = 300
// Max number of times we'll retry an unsent email before giving up and logging
// a permanent failure. At 5-min cron cadence this is ~1.7 hours of retries.
const MAX_EMAIL_ATTEMPTS = 20
// Upper bound on emails processed in a single cron run, to keep total runtime
// bounded even if a brand dumps hundreds of claims at once. Stragglers get
// picked up by the next run.
const MAX_EMAILS_PER_RUN = 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface ClaimWithClient {
  id: string
  ticket_number: number
  events: unknown
  shipment_id: string | null
  issue_type: string
  description: string | null
  compensation_request: string | null
  reshipment_status: string | null
  reshipment_id: string | null
  attachments: unknown
  carrier_confirmed_loss: boolean
  client: { company_name: string; merchant_id: string } | null
  claim_email_attempts: number
}

/**
 * Send a claim email and persist the outcome on the ticket. Always writes
 * claim_email_attempts + claim_email_last_attempt_at so we know when we last
 * tried. On success, also sets claim_email_sent_at (permanent) + clears
 * claim_email_last_error. On failure, sets claim_email_last_error and leaves
 * claim_email_sent_at NULL so the next cron run will pick it back up.
 */
async function sendAndRecord(
  supabase: ReturnType<typeof createAdminClient>,
  claim: ClaimWithClient,
): Promise<{ sent: boolean; error?: string; permanent?: boolean }> {
  const attemptNumber = (claim.claim_email_attempts || 0) + 1
  const now = new Date().toISOString()

  if (!claim.client?.merchant_id) {
    // Permanent failure — no merchant ID means we can't compose the email.
    // Record the attempt so we don't loop on it forever.
    await supabase
      .from('care_tickets')
      .update({
        claim_email_attempts: attemptNumber,
        claim_email_last_attempt_at: now,
        claim_email_last_error: 'Missing merchant_id on client',
      })
      .eq('id', claim.id)
    return { sent: false, error: 'Missing merchant_id', permanent: true }
  }

  // Fetch attachments fresh each attempt (signed URLs expire)
  const attachmentsData = claim.attachments as Array<{ name: string; url: string; path?: string }> | null
  let attachmentBuffers: Array<{ filename: string; content: Buffer }> = []
  if (attachmentsData && attachmentsData.length > 0) {
    try {
      attachmentBuffers = await fetchAttachmentBuffers(attachmentsData)
    } catch (attachmentError) {
      console.warn(`[Cron AdvanceClaims] Failed to fetch attachments for ticket #${claim.ticket_number}:`, attachmentError)
      // Continue without attachments — the email is still better than nothing
    }
  }

  const emailData = generateClaimEmail({
    merchantName: claim.client.company_name,
    merchantId: claim.client.merchant_id,
    shipmentId: claim.shipment_id || '',
    issueType: claim.issue_type as IssueType,
    description: claim.description,
    compensationRequest: claim.compensation_request,
    reshipmentStatus: claim.reshipment_status as ReshipmentStatus | null,
    reshipmentId: claim.reshipment_id,
    carrierConfirmedLoss: claim.carrier_confirmed_loss,
  })

  const result = await sendClaimEmail({
    to: ['support@shipbob.com'],
    cc: ['support@shipwithjetpack.com'],
    subject: emailData.subject,
    html: emailData.html,
    text: emailData.text,
    attachments: attachmentBuffers.length > 0 ? attachmentBuffers : undefined,
  })

  if (result.success) {
    await supabase
      .from('care_tickets')
      .update({
        claim_email_sent_at: now,
        claim_email_attempts: attemptNumber,
        claim_email_last_attempt_at: now,
        claim_email_last_error: null,
      })
      .eq('id', claim.id)
    return { sent: true }
  }

  // Failed send — record for next run to retry
  const permanent = !result.retryable || attemptNumber >= MAX_EMAIL_ATTEMPTS
  await supabase
    .from('care_tickets')
    .update({
      claim_email_attempts: attemptNumber,
      claim_email_last_attempt_at: now,
      claim_email_last_error: permanent
        ? `PERMANENT after ${attemptNumber} attempts: ${result.error}`
        : result.error,
    })
    .eq('id', claim.id)
  return { sent: false, error: result.error, permanent }
}

/**
 * Cron endpoint to advance claims and sync claim statuses
 *
 * Part 1: Advances claims from "Under Review" to "Credit Requested"
 * - Creates the appearance of a review process
 * - Automatically advances claims 5 minutes after submission
 *
 * Part 2: Syncs care ticket status to lost_in_transit_checks
 * - When care ticket is "Resolved" → claim_eligibility_status = 'approved'
 * - When care ticket is "Credit Not Approved" → claim_eligibility_status = 'denied'
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

    // Find claims that are Under Review and were created 5+ minutes ago
    const fiveMinutesAgo = new Date()
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5)

    // CRITICAL: exclude demo clients. This cron sends live emails to ShipBob
    // support — demo tickets would trigger hundreds of real emails.
    const CLAIM_SELECT = `
      id, ticket_number, events, created_at, shipment_id, issue_type,
      description, compensation_request, reshipment_status, reshipment_id,
      attachments, carrier_confirmed_loss, claim_email_attempts,
      client:clients!care_tickets_client_id_fkey(company_name, merchant_id)
    `

    // ----------------------------------------------------------------
    // Part 1a: Advance Under Review → Credit Requested (status flip)
    // We advance the status FIRST (without sending the email), then the
    // email send happens in Part 1b below. This separation means status
    // advancement can't be blocked by email issues, AND email sends
    // always go through the same self-healing path whether they're
    // first attempts or retries.
    // ----------------------------------------------------------------
    let claimsQuery = supabase
      .from('care_tickets')
      .select(CLAIM_SELECT)
      .eq('ticket_type', 'Claim')
      .eq('status', 'Under Review')
      .lte('created_at', fiveMinutesAgo.toISOString())

    await excludeDemoClients(supabase, claimsQuery)

    const { data: claimsToAdvance, error: fetchError } = await claimsQuery

    if (fetchError) {
      console.error('[Cron AdvanceClaims] Error fetching claims:', fetchError.message)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    let advanced = 0
    let errors = 0
    let emailsSent = 0
    let emailErrors = 0
    const permanentFailures: Array<{ ticketNumber: number; brand: string; error: string; attempts: number }> = []

    if (claimsToAdvance && claimsToAdvance.length > 0) {
      console.log(`[Cron AdvanceClaims] Found ${claimsToAdvance.length} claims to advance`)

      for (const claim of claimsToAdvance) {
        const events = (claim.events as Array<{ status: string; note: string; createdAt: string; createdBy: string }>) || []
        const creditRequestedEvent = {
          status: 'Credit Requested',
          note: 'Credit request has been sent to the warehouse team for review.',
          createdAt: new Date().toISOString(),
          createdBy: 'System',
        }
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

    // ----------------------------------------------------------------
    // Part 1b: Send emails for any claim that needs one (self-healing)
    //
    // This covers BOTH the just-advanced tickets from Part 1a AND any
    // ticket from prior runs whose email failed (rate-limit, network,
    // Resend outage, etc.). Query criterion: status is in the "claim
    // lifecycle" AND claim_email_sent_at IS NULL AND we haven't exhausted
    // retries. Throttled to ~3 emails/sec to stay under Resend's 5/sec.
    // ----------------------------------------------------------------
    let unsentQuery = supabase
      .from('care_tickets')
      .select(CLAIM_SELECT)
      .eq('ticket_type', 'Claim')
      // Only email tickets currently in the active claim lifecycle. Not
      // Under Review (too early) and not Resolved/Closed/Credit Not Approved
      // (too late — ShipBob has already resolved one way or another).
      .in('status', ['Credit Requested', 'Credit Approved'])
      .is('claim_email_sent_at', null)
      .lt('claim_email_attempts', MAX_EMAIL_ATTEMPTS)
      .order('claim_email_last_attempt_at', { ascending: true, nullsFirst: true })
      .limit(MAX_EMAILS_PER_RUN)

    await excludeDemoClients(supabase, unsentQuery)

    const { data: unsentClaims, error: unsentError } = await unsentQuery
    if (unsentError) {
      console.error('[Cron AdvanceClaims] Error fetching unsent claims:', unsentError.message)
    } else if (unsentClaims && unsentClaims.length > 0) {
      console.log(`[Cron AdvanceClaims] ${unsentClaims.length} claim(s) need email send/retry`)

      for (let i = 0; i < unsentClaims.length; i++) {
        const claim = unsentClaims[i] as unknown as ClaimWithClient
        const outcome = await sendAndRecord(supabase, claim)
        if (outcome.sent) {
          emailsSent++
        } else {
          emailErrors++
          if (outcome.permanent) {
            console.error(`[Cron AdvanceClaims] PERMANENT email failure for ticket #${claim.ticket_number}: ${outcome.error}`)
            permanentFailures.push({
              ticketNumber: claim.ticket_number,
              brand: claim.client?.company_name || 'Unknown',
              error: outcome.error || 'unknown',
              attempts: (claim.claim_email_attempts || 0) + 1,
            })
          }
        }
        // Throttle between sends to stay under Resend's rate limit
        if (i < unsentClaims.length - 1) await sleep(THROTTLE_MS)
      }
    }

    // Alert #support-alerts if any claim hit permanent email failure this run.
    // These won't self-heal — they've either exhausted retries or hit a
    // non-retryable error (bad merchant_id, malformed email, etc.) and need a
    // human to investigate and manually re-send via the audit script.
    if (permanentFailures.length > 0) {
      const lines = permanentFailures.map(
        (f) => `• #${f.ticketNumber} (${f.brand}) — ${f.attempts} attempts — ${f.error}`,
      )
      const body = [
        `:rotating_light: *${permanentFailures.length} claim email(s) permanently failed to send to ShipBob*`,
        '',
        ...lines,
        '',
        'These tickets advanced status but no email reached support@shipbob.com and retries are exhausted. ' +
          'Investigate via the Supabase dashboard (care_tickets.claim_email_last_error) and re-send manually via ' +
          '`scripts/audit-claim-emails.ts --resend` once the root cause is resolved.',
      ].join('\n')
      sendSlackAlert(body, 'support-alerts')
    }

    // ========================================
    // Part 2: Sync care ticket status to lost_in_transit_checks
    // ========================================
    console.log('[Cron AdvanceClaims] Starting claim status sync to lost_in_transit_checks...')

    let synced = 0
    let syncErrors = 0

    // Find care tickets that are Resolved or Credit Not Approved but their lost_in_transit_checks
    // record still has claim_eligibility_status = 'claim_filed'
    const { data: ticketsToSync, error: syncFetchError } = await supabase
      .from('care_tickets')
      .select('id, ticket_number, shipment_id, status')
      .eq('ticket_type', 'Claim')
      .in('status', ['Resolved', 'Credit Not Approved', 'Closed'])

    if (syncFetchError) {
      console.error('[Cron AdvanceClaims] Error fetching tickets to sync:', syncFetchError.message)
    } else if (ticketsToSync && ticketsToSync.length > 0) {
      console.log(`[Cron AdvanceClaims] Found ${ticketsToSync.length} resolved/denied tickets to check`)

      for (const ticket of ticketsToSync) {
        if (!ticket.shipment_id) continue

        // Determine the new status
        const newStatus = ticket.status === 'Resolved' ? 'approved'
          : (ticket.status === 'Credit Not Approved' || ticket.status === 'Closed') ? 'denied'
          : 'denied'

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

    // ========================================
    // Part 3: Create lost_in_transit_checks entries for Loss claims without one
    // This ensures ALL Loss claims appear in Delivery IQ (archived section)
    // ========================================
    console.log('[Cron AdvanceClaims] Checking for Loss claims missing Delivery IQ entries...')

    let created = 0
    let createErrors = 0

    // Find Loss care tickets (any status) that have no lost_in_transit_checks entry
    const { data: orphanedClaims, error: orphanFetchError } = await supabase
      .from('care_tickets')
      .select('shipment_id, tracking_number, carrier, client_id, status, created_at')
      .eq('issue_type', 'Loss')
      .is('deleted_at', null)
      .not('shipment_id', 'is', null)
      .not('tracking_number', 'is', null)
      .not('carrier', 'is', null)

    if (orphanFetchError) {
      console.error('[Cron AdvanceClaims] Error fetching orphaned claims:', orphanFetchError.message)
    } else if (orphanedClaims && orphanedClaims.length > 0) {
      // Deduplicate by shipment_id (keep most recent)
      const byShipment = new Map<string, typeof orphanedClaims[0]>()
      for (const claim of orphanedClaims) {
        if (!claim.shipment_id) continue
        const existing = byShipment.get(claim.shipment_id)
        if (!existing || new Date(claim.created_at) > new Date(existing.created_at)) {
          byShipment.set(claim.shipment_id, claim)
        }
      }

      // Check which shipment_ids already have LIT entries
      const shipmentIds = [...byShipment.keys()]
      const { data: existingEntries } = await supabase
        .from('lost_in_transit_checks')
        .select('shipment_id')
        .in('shipment_id', shipmentIds)

      const existingSet = new Set((existingEntries || []).map((e: { shipment_id: string }) => e.shipment_id))
      const missing = [...byShipment.entries()].filter(([sid]) => !existingSet.has(sid))

      if (missing.length > 0) {
        console.log(`[Cron AdvanceClaims] Found ${missing.length} Loss claims without Delivery IQ entries`)

        const records = missing.map(([, claim]) => ({
          shipment_id: claim.shipment_id!,
          tracking_number: claim.tracking_number!,
          carrier: claim.carrier!,
          client_id: claim.client_id,
          claim_eligibility_status: claim.status === 'Resolved' ? 'approved'
            : (claim.status === 'Credit Not Approved' || claim.status === 'Closed') ? 'denied'
            : 'claim_filed',
          checked_at: claim.created_at,
          first_checked_at: claim.created_at,
          eligible_after: claim.created_at.split('T')[0],
          is_international: (claim.carrier || '').toLowerCase().includes('dhl'),
        }))

        const { error: insertError } = await supabase
          .from('lost_in_transit_checks')
          .insert(records)

        if (insertError) {
          console.error('[Cron AdvanceClaims] Error creating entries:', insertError.message)
          createErrors++
        } else {
          created = records.length
          console.log(`[Cron AdvanceClaims] Created ${created} Delivery IQ entries`)
        }
      }
    }

    const duration = Date.now() - startTime
    console.log(`[Cron AdvanceClaims] Completed in ${duration}ms: ${advanced} advanced, ${emailsSent} emails sent, ${emailErrors} email failures (${permanentFailures.length} permanent), ${synced} synced, ${created} created, ${errors + syncErrors + createErrors} non-email errors`)

    return NextResponse.json({
      success: errors === 0 && syncErrors === 0 && createErrors === 0,
      duration: `${duration}ms`,
      claimsAdvanced: advanced,
      emailsSent,
      emailErrors,
      emailPermanentFailures: permanentFailures.length,
      claimsSynced: synced,
      deliveryIqEntriesCreated: created,
      errors: errors + syncErrors + createErrors,
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
