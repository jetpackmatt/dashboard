import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/monitoring/stats
 *
 * Returns counts for Delivery IQ quick filters.
 * Uses a single RPC that consolidates all counts + aggregates in one DB call
 * (replaces the previous 15-query pattern that was extremely slow).
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
    // Single RPC: all 13 counts + watch breakdown + days-silent histogram
    // Misfit exclusion is handled via LEFT JOIN inside the function
    const [statsResult, activeResult] = await Promise.all([
      supabase.rpc('get_monitoring_stats', {
        p_client_id: clientId && clientId !== 'all' ? clientId : null,
        p_start_date: startDate ? `${startDate}T00:00:00Z` : null,
        p_end_date: endDate ? `${endDate}T23:59:59Z` : null,
      }),
      // Active shipments count (separate — different table, lightweight)
      (async () => {
        let activeQuery = supabase
          .from('shipments')
          .select('id', { count: 'exact', head: true })
          .is('event_delivered', null)
        if (clientId && clientId !== 'all') {
          activeQuery = activeQuery.eq('client_id', clientId)
        }
        const { count } = await activeQuery
        return count || 0
      })(),
    ])

    if (statsResult.error) {
      console.error('[Monitoring Stats] RPC error:', statsResult.error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const stats = statsResult.data
    const c = stats.counts

    return NextResponse.json({
      atRisk: (c.at_risk_all || 0) - (c.needs_action || 0),
      needsAction: c.needs_action || 0,
      eligible: c.eligible || 0,
      claimFiled: c.claim_filed || 0,
      returnedToSender: c.returned_to_sender || 0,
      total: c.total || 0,
      archived: c.archived || 0,
      reshipNow: c.reship_now || 0,
      considerReship: c.consider_reship || 0,
      customerAnxious: c.customer_anxious || 0,
      stuck: c.stuck || 0,
      returning: c.returning || 0,
      lost: c.lost || 0,
      totalActiveShipments: activeResult,
      // Lightweight aggregates for homepage panels
      watchBreakdown: stats.watch_breakdown || [],
      daysSilentAvg: stats.days_silent_avg || 0,
      daysSilentHistogram: stats.days_silent_histogram || [],
    })
  } catch (error) {
    console.error('[Monitoring Stats] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
