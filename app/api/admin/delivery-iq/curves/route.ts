/**
 * Admin API: Survival Curves
 *
 * Returns survival curve data for visualization and analysis.
 * Supports filtering by carrier, zone, season, and service.
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
  const searchParams = request.nextUrl.searchParams

  // Parse filters
  const carrier = searchParams.get('carrier')
  const zoneBucket = searchParams.get('zone')
  const seasonBucket = searchParams.get('season')
  const serviceBucket = searchParams.get('service')

  try {
    // Build query
    let query = supabase
      .from('survival_curves')
      .select('*')
      .order('sample_size', { ascending: false })

    if (carrier) {
      query = query.eq('carrier', carrier)
    }
    if (zoneBucket) {
      query = query.eq('zone_bucket', zoneBucket)
    }
    if (seasonBucket) {
      query = query.eq('season_bucket', seasonBucket)
    }
    if (serviceBucket) {
      query = query.eq('service_bucket', serviceBucket)
    }

    const { data: curves, error } = await query.limit(100)

    if (error) {
      throw error
    }

    // Get available filter options
    const { data: allCurves } = await supabase
      .from('survival_curves')
      .select('carrier, zone_bucket, season_bucket, service_bucket')

    const filterOptions = {
      carriers: [...new Set((allCurves || []).map((c: { carrier: string }) => c.carrier))].sort(),
      zones: [...new Set((allCurves || []).map((c: { zone_bucket: string }) => c.zone_bucket))].sort(),
      seasons: [...new Set((allCurves || []).map((c: { season_bucket: string }) => c.season_bucket))].sort(),
      services: [...new Set((allCurves || []).map((c: { service_bucket: string }) => c.service_bucket))].sort(),
    }

    return NextResponse.json({
      curves: curves || [],
      filterOptions,
      appliedFilters: {
        carrier,
        zone: zoneBucket,
        season: seasonBucket,
        service: serviceBucket,
      },
    })
  } catch (error) {
    console.error('[Delivery IQ Curves] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch curves' },
      { status: 500 }
    )
  }
}
