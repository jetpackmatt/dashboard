import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateUserCommission,
  getUserCommissionAssignment,
  getLastShipmentDates,
} from '@/lib/commissions/calculator'

/**
 * GET /api/data/commissions
 *
 * Get current user's commission data for the current month.
 * Returns real-time calculated commission based on shipment counts.
 *
 * Optional query params:
 * - year: Override year (default: current year)
 * - month: Override month (default: current month)
 * - userId: (Admin only) Preview commissions for another user
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

    // Check if target user has a commission assignment
    const assignment = await getUserCommissionAssignment(adminClient, targetUserId)

    if (!assignment) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No commission assignment found',
      })
    }

    // Get year and month from query params or use current
    const now = new Date()
    const year = parseInt(searchParams.get('year') || String(now.getFullYear()), 10)
    const month = parseInt(searchParams.get('month') || String(now.getMonth() + 1), 10)

    // Calculate commission
    const result = await calculateUserCommission(adminClient, targetUserId, year, month)

    if (!result) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'Unable to calculate commission',
      })
    }

    // Get last shipment dates by partner
    const lastShipmentDates = await getLastShipmentDates(adminClient, targetUserId)

    return NextResponse.json({
      success: true,
      data: {
        currentMonth: result,
        userCommission: assignment,
        period: { year, month },
        lastShipmentDates,
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Error in commissions GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
