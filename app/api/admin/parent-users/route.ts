import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getParentLevelUsers } from '@/lib/supabase/admin'

/**
 * GET /api/admin/parent-users
 *
 * Get all parent-level users (not assigned to any brand).
 * Admin only.
 */
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const users = await getParentLevelUsers()

    return NextResponse.json({ success: true, data: users })
  } catch (error) {
    console.error('Error fetching parent users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
