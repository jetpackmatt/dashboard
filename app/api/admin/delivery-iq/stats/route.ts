/**
 * Admin API: Delivery IQ Statistics
 *
 * Returns comprehensive stats for the Delivery Intelligence Engine dashboard.
 * Admin-only endpoint.
 *
 * IMPORTANT: Uses count queries to avoid Supabase's 1000 row limit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  // Verify admin access
  try {
    const access = await verifyClientAccess('all')
    if (!access.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  try {
    // 1. Get outcome counts using individual count queries (avoids 1000 row limit)
    const outcomeTypes = ['delivered', 'lost_claim', 'lost_exception', 'lost_timeout', 'lost_tracking', 'censored']
    const outcomeCounts = await Promise.all(
      outcomeTypes.map(async (outcome) => {
        const { count } = await supabase
          .from('delivery_outcomes')
          .select('*', { count: 'exact', head: true })
          .eq('outcome', outcome)
        return { outcome, count: count || 0 }
      })
    )

    const outcomeStats: Record<string, number> = {}
    for (const { outcome, count } of outcomeCounts) {
      outcomeStats[outcome] = count
    }

    // 2. Get carrier stats using distinct carriers from survival_curves (smaller table)
    // NOTE: delivery_outcomes query with .limit(1000) fails because all 1000 rows might be same carrier
    const { data: curvesForCarriers } = await supabase
      .from('survival_curves')
      .select('carrier')

    // Get unique carriers from curves (excluding 'all')
    const uniqueCarriers = [...new Set((curvesForCarriers || [])
      .map((r: { carrier: string }) => r.carrier)
      .filter((c: string) => c !== 'all'))]

    const carrierStats = await Promise.all(
      uniqueCarriers.slice(0, 25).map(async (carrier) => {
        const [totalResult, deliveredResult, lostResult] = await Promise.all([
          supabase.from('delivery_outcomes').select('*', { count: 'exact', head: true }).eq('carrier', carrier),
          supabase.from('delivery_outcomes').select('*', { count: 'exact', head: true }).eq('carrier', carrier).eq('outcome', 'delivered'),
          supabase.from('delivery_outcomes').select('*', { count: 'exact', head: true }).eq('carrier', carrier).like('outcome', 'lost%'),
        ])

        const total = totalResult.count || 0
        const delivered = deliveredResult.count || 0
        const lost = lostResult.count || 0

        return {
          carrier,
          total,
          deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(2) : '0.00',
          lossRate: total > 0 ? ((lost / total) * 100).toFixed(2) : '0.00',
        }
      })
    )

    // Sort by total descending
    carrierStats.sort((a, b) => b.total - a.total)

    // 3. Survival curve stats (small table, no pagination needed)
    const { data: curves } = await supabase
      .from('survival_curves')
      .select('id, carrier, confidence_level, sample_size, median_days, computed_at')

    type CurveRow = { confidence_level: string; median_days: number | null; computed_at: string }
    const curveStats = {
      totalCurves: curves?.length || 0,
      byConfidence: (curves || []).reduce((acc: Record<string, number>, row: CurveRow) => {
        acc[row.confidence_level] = (acc[row.confidence_level] || 0) + 1
        return acc
      }, {} as Record<string, number>),
      avgMedianDays: curves && curves.length > 0
        ? (curves.reduce((sum: number, r: CurveRow) => sum + (r.median_days || 0), 0) / curves.length).toFixed(2)
        : null,
      lastComputed: curves && curves.length > 0
        ? curves.reduce((latest: string, r: CurveRow) => r.computed_at > latest ? r.computed_at : latest, curves[0].computed_at)
        : null,
    }

    // 4. Confidence heatmap (from survival_curves - small table)
    // Keep individual zones for accuracy (zone_1 through zone_10, international)
    const { data: heatmapData } = await supabase
      .from('survival_curves')
      .select('carrier, zone_bucket, confidence_level, sample_size')

    const confidenceHeatmap: Record<string, Record<string, { confidence: string; sampleSize: number }>> = {}
    for (const row of heatmapData || []) {
      if (row.carrier === 'all') continue
      if (!confidenceHeatmap[row.carrier]) {
        confidenceHeatmap[row.carrier] = {}
      }
      const existing = confidenceHeatmap[row.carrier][row.zone_bucket]
      // Keep the one with higher sample size if duplicates exist
      if (!existing || row.sample_size > existing.sampleSize) {
        confidenceHeatmap[row.carrier][row.zone_bucket] = {
          confidence: row.confidence_level,
          sampleSize: row.sample_size,
        }
      }
    }

    // 5. Checkpoint stats using count queries
    const [totalCheckpoints, normalizedCheckpoints] = await Promise.all([
      supabase.from('tracking_checkpoints').select('*', { count: 'exact', head: true }),
      supabase.from('tracking_checkpoints').select('*', { count: 'exact', head: true }).not('normalized_type', 'is', null),
    ])

    const checkpointStats = {
      totalCheckpoints: totalCheckpoints.count || 0,
      normalized: normalizedCheckpoints.count || 0,
      unnormalized: (totalCheckpoints.count || 0) - (normalizedCheckpoints.count || 0),
    }

    // Calculate totals
    const totalOutcomes = Object.values(outcomeStats).reduce((a, b) => a + b, 0)
    const deliveredCount = outcomeStats['delivered'] || 0
    const lostCount = (outcomeStats['lost_claim'] || 0) +
                      (outcomeStats['lost_exception'] || 0) +
                      (outcomeStats['lost_timeout'] || 0) +
                      (outcomeStats['lost_tracking'] || 0)

    // Count carriers from survival_curves (more accurate than carrierStats which may be filtered)
    const carriersTrackedCount = uniqueCarriers.length

    return NextResponse.json({
      // Overview stats
      overview: {
        totalTrainingRecords: totalOutcomes,
        deliveryRate: totalOutcomes > 0 ? ((deliveredCount / totalOutcomes) * 100).toFixed(2) : '0',
        lossRate: totalOutcomes > 0 ? ((lostCount / totalOutcomes) * 100).toFixed(2) : '0',
        totalCurves: curveStats.totalCurves,
        highConfidenceCurves: curveStats.byConfidence['high'] || 0,
        mediumConfidenceCurves: curveStats.byConfidence['medium'] || 0,
        lowConfidenceCurves: curveStats.byConfidence['low'] || 0,
        carriersTracked: carriersTrackedCount,
        avgMedianTransit: curveStats.avgMedianDays,
        lastCurveComputation: curveStats.lastComputed,
        deliveredCount,
        lostCount,
        censoredCount: outcomeStats['censored'] || 0,
      },

      // Outcome distribution
      outcomes: {
        delivered: outcomeStats['delivered'] || 0,
        lost_claim: outcomeStats['lost_claim'] || 0,
        lost_exception: outcomeStats['lost_exception'] || 0,
        lost_timeout: outcomeStats['lost_timeout'] || 0,
        lost_tracking: outcomeStats['lost_tracking'] || 0,
        censored: outcomeStats['censored'] || 0,
      },

      // Curve confidence distribution
      curveConfidence: curveStats.byConfidence,

      // Carrier performance table
      carriers: carrierStats.slice(0, 20),

      // Confidence heatmap
      confidenceHeatmap,

      // Checkpoint stats
      checkpoints: checkpointStats,
    })
  } catch (error) {
    console.error('[Delivery IQ Stats] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}
