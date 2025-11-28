import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inviteUser } from '@/lib/supabase/admin'

/**
 * POST /api/admin/users/invite
 * Invite a user to a client (admin only)
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

    // TODO: Add proper admin role check from user metadata
    // const isAdmin = user.user_metadata?.role === 'admin'
    // if (!isAdmin) {
    //   return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    // }

    const body = await request.json()
    const { email, client_id, role, full_name } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    if (!client_id || typeof client_id !== 'string') {
      return NextResponse.json(
        { error: 'Client ID is required' },
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

    // Validate role
    const validRoles = ['owner', 'editor', 'viewer']
    const userRole = validRoles.includes(role) ? role : 'viewer'

    const result = await inviteUser({
      email: email.trim().toLowerCase(),
      clientId: client_id,
      role: userRole as 'owner' | 'editor' | 'viewer',
      fullName: full_name?.trim(),
      invitedBy: user.id,
    })

    return NextResponse.json(
      {
        success: true,
        user: result.user,
        message: `Invitation sent to ${email}`,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error inviting user:', error)
    const message = error instanceof Error ? error.message : 'Failed to invite user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
