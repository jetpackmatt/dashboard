import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/data/commissions/history
 *
 * Get user's historical commission snapshots (locked months).
 * Returns snapshots ordered by most recent first.
 *
 * Optional query params:
 * - userId: (Admin only) Preview history for another user
 */
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const searchParams = request.nextUrl.searchParams

    // Check for admin preview mode
    const previewUserId = searchParams.get('userId')
    let targetUserId = user.id

    if (previewUserId) {
      // Only admins can preview other users
      if (user.user_metadata?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      targetUserId = previewUserId
    }

    // Get target user's active commission assignment
    const { data: userCommission, error: ucError } = await adminClient
      .from('user_commissions')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('is_active', true)
      .single()

    if (ucError || !userCommission) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No commission assignment found',
      })
    }

    // Get snapshots for this user commission
    const { data: snapshots, error: snapshotsError } = await adminClient
      .from('commission_snapshots')
      .select('*')
      .eq('user_commission_id', userCommission.id)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
      .limit(24) // Last 2 years max

    if (snapshotsError) {
      console.error('Error fetching commission snapshots:', snapshotsError)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: snapshots || [],
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Error in commissions history GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
