import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Cron job to refresh the carrier options materialized views
 * Schedule: Daily at 5:30 AM UTC (after sync-products)
 *
 * This refreshes the carrier_options_by_client and carrier_options_all
 * materialized views used for the carrier filter dropdown.
 *
 * Performance impact: Eliminates 114ms query per API request
 */
export async function GET(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get('authorization')
  if (process.env.VERCEL_ENV === 'production') {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startTime = Date.now()
  const supabase = createAdminClient()

  try {
    // Refresh both materialized views
    // Note: REFRESH MATERIALIZED VIEW requires direct SQL execution
    const { error: error1 } = await supabase.rpc('refresh_carrier_views')

    if (error1) {
      // If RPC doesn't exist, try direct refresh (requires function to be created)
      console.log('[refresh-carrier-views] RPC not available, views may need manual refresh')
      return NextResponse.json({
        success: false,
        message: 'RPC function not available. Run the migration script first.',
        error: error1.message,
        duration: Date.now() - startTime,
      })
    }

    console.log(`[refresh-carrier-views] Refreshed carrier views in ${Date.now() - startTime}ms`)

    return NextResponse.json({
      success: true,
      message: 'Carrier views refreshed',
      duration: Date.now() - startTime,
    })
  } catch (err) {
    console.error('[refresh-carrier-views] Error:', err)
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      duration: Date.now() - startTime,
    }, { status: 500 })
  }
}
