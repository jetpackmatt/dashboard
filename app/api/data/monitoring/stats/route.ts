import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/monitoring/stats
 *
 * Returns counts for Delivery IQ quick filters.
 */
export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  try {
    // Fetch shipment IDs that have misfit credits (credit exists but not linked to care ticket).
    // These are excluded from On Watch, Needs Action, Ready to File counts.
    const { data: misfitCredits } = await supabase
      .from('transactions')
      .select('reference_id')
      .eq('fee_type', 'Credit')
      .is('care_ticket_id', null)
      .eq('is_voided', false)
      .is('dispute_status', null)
      .eq('reference_type', 'Shipment')
      .not('reference_id', 'is', null)
      .limit(1000)

    const misfitShipmentIds = [...new Set((misfitCredits || []).map((t: { reference_id: string }) => t.reference_id).filter(Boolean))]

    // Helper: apply shared filters (clientId, date range) to a query builder
    function applyBaseFilters(query: ReturnType<typeof supabase.from>) {
      let q = query
      if (clientId && clientId !== 'all') {
        q = q.eq('client_id', clientId)
      }
      if (startDate) {
        q = q.gte('first_checked_at', `${startDate}T00:00:00Z`)
      }
      if (endDate) {
        q = q.lte('first_checked_at', `${endDate}T23:59:59Z`)
      }
      return q
    }

    // Helper: exclude shipments with misfit credits
    function excludeMisfits(query: ReturnType<typeof supabase.from>) {
      if (misfitShipmentIds.length > 0) {
        return query.not('shipment_id', 'in', `(${misfitShipmentIds.join(',')})`)
      }
      return query
    }

    // Run count queries in parallel
    const [
      atRiskAllResult,
      needsActionResult,
      eligibleResult,
      claimFiledResult,
      returnedToSenderResult,
      totalResult,
      archivedResult,
      reshipNowResult,
      considerReshipResult,
      customerAnxiousResult,
      stuckResult,
      returningResult,
      lostResult,
    ] = await Promise.all([
      // at_risk total (includes NEEDS ACTION — we subtract below)
      // Excludes shipments with misfit credits (handled in Misfits workflow)
      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'at_risk')))
        .then((r: { count: number | null }) => r.count || 0),

      // Needs Action = at_risk with watch_reason = 'NEEDS ACTION'
      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'at_risk')
        .eq('watch_reason', 'NEEDS ACTION')))
        .then((r: { count: number | null }) => r.count || 0),

      // Excludes shipments with misfit credits
      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'eligible')))
        .then((r: { count: number | null }) => r.count || 0),

      applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'claim_filed'))
        .then((r: { count: number | null }) => r.count || 0),

      // Returned to sender
      applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'returned_to_sender'))
        .then((r: { count: number | null }) => r.count || 0),

      // Total = all active (excludes archived and RTS)
      applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .in('claim_eligibility_status', ['at_risk', 'eligible', 'claim_filed']))
        .then((r: { count: number | null }) => r.count || 0),

      // Archived = approved, denied, or missed_window
      applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .in('claim_eligibility_status', ['approved', 'denied', 'missed_window']))
        .then((r: { count: number | null }) => r.count || 0),

      // AI-driven counts (exclude misfits — these are subsets of at_risk)
      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .gte('ai_reshipment_urgency', 80)))
        .then((r: { count: number | null }) => r.count || 0),

      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .gte('ai_reshipment_urgency', 60)
        .lt('ai_reshipment_urgency', 80)))
        .then((r: { count: number | null }) => r.count || 0),

      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .gte('ai_customer_anxiety', 70)))
        .then((r: { count: number | null }) => r.count || 0),

      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .in('ai_status_badge', ['STUCK', 'STALLED'])))
        .then((r: { count: number | null }) => r.count || 0),

      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('ai_status_badge', 'RETURNING')))
        .then((r: { count: number | null }) => r.count || 0),

      excludeMisfits(applyBaseFilters(supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('ai_status_badge', 'LOST')))
        .then((r: { count: number | null }) => r.count || 0),
    ])

    // Fetch active (non-delivered) orders count
    // Powers the "Active Orders" KPI card — all shipments from creation until delivery
    let totalActiveShipments = 0
    try {
      let activeQuery = supabase
        .from('shipments')
        .select('id', { count: 'exact', head: true })
        .is('event_delivered', null)
      if (clientId && clientId !== 'all') {
        activeQuery = activeQuery.eq('client_id', clientId)
      }
      const { count } = await activeQuery
      totalActiveShipments = count || 0
    } catch (err) {
      console.error('[Monitoring Stats] Active orders count error:', err)
    }

    // Lightweight aggregates for homepage panels (avoids fetching full shipment list)
    // Fetch watch_reason + last_scan_date for at_risk records only
    let watchBreakdown: { reason: string; count: number }[] = []
    let daysSilentAvg = 0
    let daysSilentHistogram: { day: string; count: number }[] = []

    try {
      let atRiskQuery = supabase
        .from('lost_in_transit_checks')
        .select('watch_reason, last_scan_date')
        .eq('claim_eligibility_status', 'at_risk')
      if (clientId && clientId !== 'all') {
        atRiskQuery = atRiskQuery.eq('client_id', clientId)
      }
      if (startDate) atRiskQuery = atRiskQuery.gte('first_checked_at', `${startDate}T00:00:00Z`)
      if (endDate) atRiskQuery = atRiskQuery.lte('first_checked_at', `${endDate}T23:59:59Z`)
      // Exclude misfits from aggregate data too
      if (misfitShipmentIds.length > 0) {
        atRiskQuery = atRiskQuery.not('shipment_id', 'in', `(${misfitShipmentIds.join(',')})`)
      }
      atRiskQuery = atRiskQuery.order('id', { ascending: true }).limit(1000)

      const { data: atRiskRows } = await atRiskQuery
      if (atRiskRows && atRiskRows.length > 0) {
        // Watch reason breakdown
        const reasonCounts: Record<string, number> = {}
        for (const row of atRiskRows) {
          const reason = row.watch_reason || 'STALLED'
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
        }
        watchBreakdown = Object.entries(reasonCounts)
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count)

        // Days silent histogram (0-15+)
        const now = new Date()
        const maxDay = 15
        const buckets: number[] = new Array(maxDay + 1).fill(0)
        let totalDays = 0
        let countWithDate = 0

        for (const row of atRiskRows) {
          if (row.last_scan_date) {
            const scanDate = new Date(row.last_scan_date)
            const daysSilent = Math.max(0, Math.floor((now.getTime() - scanDate.getTime()) / (1000 * 60 * 60 * 24)))
            const bucket = Math.min(daysSilent, maxDay)
            buckets[bucket]++
            totalDays += daysSilent
            countWithDate++
          }
        }

        daysSilentAvg = countWithDate > 0 ? totalDays / countWithDate : 0
        daysSilentHistogram = buckets.map((count, i) => ({
          day: i < maxDay ? String(i) : `${maxDay}+`,
          count,
        }))
      }
    } catch (err) {
      console.error('[Monitoring Stats] Aggregate fetch error:', err)
    }

    return NextResponse.json({
      atRisk: atRiskAllResult - needsActionResult,
      needsAction: needsActionResult,
      eligible: eligibleResult,
      claimFiled: claimFiledResult,
      returnedToSender: returnedToSenderResult,
      total: totalResult,
      archived: archivedResult,
      reshipNow: reshipNowResult,
      considerReship: considerReshipResult,
      customerAnxious: customerAnxiousResult,
      stuck: stuckResult,
      returning: returningResult,
      lost: lostResult,
      totalActiveShipments,
      // Lightweight aggregates for homepage panels
      watchBreakdown,
      daysSilentAvg,
      daysSilentHistogram,
    })
  } catch (error) {
    console.error('[Monitoring Stats] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
