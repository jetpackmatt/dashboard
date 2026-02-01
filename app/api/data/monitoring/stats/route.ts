import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/monitoring/stats
 *
 * Returns counts for Lookout AI quick filters.
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
    // Build base query conditions
    let baseConditions = ''
    const params: Record<string, string> = {}

    if (clientId && clientId !== 'all') {
      baseConditions += ` AND client_id = '${clientId}'`
    }

    if (startDate) {
      baseConditions += ` AND first_checked_at >= '${startDate}T00:00:00Z'`
    }
    if (endDate) {
      baseConditions += ` AND first_checked_at <= '${endDate}T23:59:59Z'`
    }

    // Run count queries in parallel
    const [
      atRiskResult,
      eligibleResult,
      claimFiledResult,
      totalResult,
      archivedResult,
      reshipNowResult,
      considerReshipResult,
      customerAnxiousResult,
      stuckResult,
      returningResult,
      lostResult,
    ] = await Promise.all([
      // Claim lifecycle counts
      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'at_risk')
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'eligible')
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('claim_eligibility_status', 'claim_filed')
        .then((r: { count: number | null }) => r.count || 0),

      // Total = all active (excludes archived)
      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .in('claim_eligibility_status', ['at_risk', 'eligible', 'claim_filed'])
        .then((r: { count: number | null }) => r.count || 0),

      // Archived = approved, denied, or missed_window
      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .in('claim_eligibility_status', ['approved', 'denied', 'missed_window'])
        .then((r: { count: number | null }) => r.count || 0),

      // AI-driven counts
      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .gte('ai_reshipment_urgency', 80)
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .gte('ai_reshipment_urgency', 60)
        .lt('ai_reshipment_urgency', 80)
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .gte('ai_customer_anxiety', 70)
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .in('ai_status_badge', ['STUCK', 'STALLED'])
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('ai_status_badge', 'RETURNING')
        .then((r: { count: number | null }) => r.count || 0),

      supabase
        .from('lost_in_transit_checks')
        .select('id', { count: 'exact', head: true })
        .eq('ai_status_badge', 'LOST')
        .then((r: { count: number | null }) => r.count || 0),
    ])

    return NextResponse.json({
      atRisk: atRiskResult,
      eligible: eligibleResult,
      claimFiled: claimFiledResult,
      total: totalResult,
      archived: archivedResult,
      reshipNow: reshipNowResult,
      considerReship: considerReshipResult,
      customerAnxious: customerAnxiousResult,
      stuck: stuckResult,
      returning: returningResult,
      lost: lostResult,
    })
  } catch (error) {
    console.error('[Monitoring Stats] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
