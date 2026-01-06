import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCareUser, getCareUsers } from '@/lib/supabase/admin'

/**
 * GET /api/admin/care-users
 * Returns all Care team users (admin only)
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

    // Only admins can manage Care users
    const isAdmin = user.user_metadata?.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const careUsers = await getCareUsers()

    return NextResponse.json({
      users: careUsers,
      count: careUsers.length,
    })
  } catch (error) {
    console.error('Error fetching care users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch care users' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/care-users
 * Create a new Care team user (admin only)
 */
export async function POST(request: Request) {
  try {
    // Verify user is authenticated and is admin
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admins can create Care users
    const isAdmin = user.user_metadata?.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { email, role, full_name } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Validate role - allow admin, care_admin, care_team
    const validRoles = ['admin', 'care_admin', 'care_team']
    if (!role || !validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be admin, care_admin, or care_team' },
        { status: 400 }
      )
    }

    const result = await createCareUser({
      email: email.trim().toLowerCase(),
      role: role as 'admin' | 'care_admin' | 'care_team',
      fullName: full_name?.trim(),
    })

    return NextResponse.json(
      {
        success: true,
        user: result.user,
        message: `Care user created: ${email}`,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating care user:', error)
    const message = error instanceof Error ? error.message : 'Failed to create care user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
