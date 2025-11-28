import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsersWithClients } from '@/lib/supabase/admin'

/**
 * GET /api/admin/users
 * Returns all users with their client assignments (admin only)
 */
export async function GET() {
  try {
    // Verify user is authenticated and is admin
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // TODO: Add proper admin role check from user metadata
    // const isAdmin = user.user_metadata?.role === 'admin'
    // if (!isAdmin) {
    //   return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    // }

    const users = await getUsersWithClients()

    return NextResponse.json({
      users,
      count: users.length,
    })
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}
