import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

// Type for lost_in_transit_checks record
interface LostInTransitCheck {
  id: string
  shipment_id: string
  tracking_number: string
  carrier: string | null
  client_id: string | null
  is_international: boolean | null
  eligible_after: string | null
  claim_eligibility_status: string | null
  last_scan_date: string | null
  last_scan_description: string | null
  trackingmore_tracking_id: string | null
  first_checked_at: string | null
  last_recheck_at: string | null
  ai_assessment: Record<string, unknown> | null
  ai_assessed_at: string | null
  ai_next_check_at: string | null
  ai_status_badge: string | null
  ai_risk_level: string | null
  ai_reshipment_urgency: number | null
  ai_customer_anxiety: number | null
  ai_predicted_outcome: string | null
  first_carrier_scan_at: string | null
  days_in_transit: number | null
  stuck_at_facility: string | null
  stuck_duration_days: number | null
  checked_at: string | null
}

// Helper to calculate days since a date
function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * GET /api/data/monitoring/shipments
 *
 * Returns monitored shipments for Lookout AI dashboard.
 * Filters by claim eligibility status and AI-derived fields.
 */
export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  let isAdmin = false
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
    isAdmin = access.isAdmin
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  // Parse query params
  const filter = searchParams.get('filter') || 'at_risk'
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  // Higher default limit since we're doing client-side pagination
  const limit = Math.min(parseInt(searchParams.get('limit') || '1000'), 1000)
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    // Build query - note: days_since_last_update is calculated from last_scan_date
    let query = supabase
      .from('lost_in_transit_checks')
      .select(`
        id,
        shipment_id,
        tracking_number,
        carrier,
        client_id,
        is_international,
        eligible_after,
        claim_eligibility_status,
        last_scan_date,
        last_scan_description,
        trackingmore_tracking_id,
        first_checked_at,
        last_recheck_at,
        ai_assessment,
        ai_assessed_at,
        ai_next_check_at,
        ai_status_badge,
        ai_risk_level,
        ai_reshipment_urgency,
        ai_customer_anxiety,
        ai_predicted_outcome,
        first_carrier_scan_at,
        days_in_transit,
        stuck_at_facility,
        stuck_duration_days,
        checked_at
      `)

    // Client filter (admins can see all, clients see only their own)
    if (clientId && clientId !== 'all') {
      query = query.eq('client_id', clientId)
    }

    // Apply filter
    switch (filter) {
      case 'at_risk':
        query = query.eq('claim_eligibility_status', 'at_risk')
        break
      case 'eligible':
        query = query.eq('claim_eligibility_status', 'eligible')
        break
      case 'claim_filed':
        query = query.eq('claim_eligibility_status', 'claim_filed')
        break
      case 'all':
        // All active (excludes archived)
        query = query.in('claim_eligibility_status', ['at_risk', 'eligible', 'claim_filed'])
        break
      case 'archived':
        // Archived = approved, denied, or missed_window
        query = query.in('claim_eligibility_status', ['approved', 'denied', 'missed_window'])
        break
      // AI-driven filters
      case 'reship_now':
        query = query.gte('ai_reshipment_urgency', 80)
        break
      case 'consider_reship':
        query = query.gte('ai_reshipment_urgency', 60).lt('ai_reshipment_urgency', 80)
        break
      case 'customer_anxious':
        query = query.gte('ai_customer_anxiety', 70)
        break
      case 'stuck':
        query = query.in('ai_status_badge', ['STUCK', 'STALLED'])
        break
      case 'returning':
        query = query.eq('ai_status_badge', 'RETURNING')
        break
      case 'lost':
        query = query.eq('ai_status_badge', 'LOST')
        break
      default:
        query = query.eq('claim_eligibility_status', 'at_risk')
    }

    // Date filter on first_checked_at
    if (startDate) {
      query = query.gte('first_checked_at', `${startDate}T00:00:00Z`)
    }
    if (endDate) {
      query = query.lte('first_checked_at', `${endDate}T23:59:59Z`)
    }

    // Order by last_scan_date (oldest first = most urgent)
    query = query
      .order('last_scan_date', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1)

    const { data: checks, error: checksError } = await query

    if (checksError) {
      console.error('[Monitoring] Error fetching checks:', checksError)
      return NextResponse.json(
        { error: 'Failed to fetch monitored shipments' },
        { status: 500 }
      )
    }

    // Get client names for admin view
    let clientMap: Map<string, string> = new Map()
    if (isAdmin && checks && checks.length > 0) {
      const clientIds = [...new Set((checks as LostInTransitCheck[]).map((c: LostInTransitCheck) => c.client_id).filter(Boolean))]
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, company_name')
          .in('id', clientIds as string[])

        if (clients) {
          for (const client of clients) {
            clientMap.set(client.id, client.company_name)
          }
        }
      }
    }

    // Get shipment data for ship dates
    const shipmentIds = (checks as LostInTransitCheck[] || []).map((c: LostInTransitCheck) => c.shipment_id).filter(Boolean)
    let shipmentMap: Map<string, { eventLabeled: string }> = new Map()
    if (shipmentIds.length > 0) {
      const { data: shipments } = await supabase
        .from('shipments')
        .select('shipment_id, event_labeled')
        .in('shipment_id', shipmentIds)

      if (shipments) {
        for (const s of shipments) {
          shipmentMap.set(s.shipment_id, { eventLabeled: s.event_labeled })
        }
      }
    }

    // Get care ticket status for shipments with claims filed
    let careTicketMap: Map<string, string> = new Map()
    if (shipmentIds.length > 0) {
      const { data: careTickets } = await supabase
        .from('care_tickets')
        .select('shipment_id, status')
        .in('shipment_id', shipmentIds)
        .eq('issue_type', 'Loss')
        .order('created_at', { ascending: false })

      if (careTickets) {
        // Keep only the most recent ticket per shipment
        for (const ticket of careTickets) {
          if (!careTicketMap.has(ticket.shipment_id)) {
            careTicketMap.set(ticket.shipment_id, ticket.status)
          }
        }
      }
    }

    // Transform data for response
    const data = ((checks as LostInTransitCheck[]) || []).map((check: LostInTransitCheck) => ({
      id: check.id,
      shipmentId: check.shipment_id,
      trackingNumber: check.tracking_number,
      carrier: check.carrier,
      clientId: check.client_id,
      clientName: clientMap.get(check.client_id || '') || 'Unknown',
      shipDate: shipmentMap.get(check.shipment_id)?.eventLabeled || null,
      lastScanDate: check.last_scan_date,
      daysSilent: daysSince(check.last_scan_date), // Calculate from last_scan_date
      daysInTransit: check.days_in_transit,
      claimEligibilityStatus: check.claim_eligibility_status,
      // Care ticket status for filed claims (shows actual ticket status)
      careTicketStatus: careTicketMap.get(check.shipment_id) || null,
      // AI fields
      aiStatusBadge: check.ai_status_badge,
      aiRiskLevel: check.ai_risk_level,
      aiReshipmentUrgency: check.ai_reshipment_urgency,
      aiCustomerAnxiety: check.ai_customer_anxiety,
      aiPredictedOutcome: check.ai_predicted_outcome,
      aiAssessment: check.ai_assessment,
      aiAssessedAt: check.ai_assessed_at,
      // Transit metrics
      firstCarrierScanAt: check.first_carrier_scan_at,
      stuckAtFacility: check.stuck_at_facility,
      stuckDurationDays: check.stuck_duration_days,
    }))

    return NextResponse.json({
      data,
      totalCount: data.length,
    })
  } catch (error) {
    console.error('[Monitoring] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
