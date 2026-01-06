import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateCareUserRole } from '@/lib/supabase/admin'

/**
 * PATCH /api/admin/care-users/[userId]
 * Update a Care user's role (admin only)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

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

    const body = await request.json()
    const { role } = body

    // Validate role
    const validRoles = ['care_admin', 'care_team', null]
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be care_admin, care_team, or null (to remove)' },
        { status: 400 }
      )
    }

    await updateCareUserRole(userId, role)

    return NextResponse.json({
      success: true,
      message: role ? `User role updated to ${role}` : 'Care role removed from user',
    })
  } catch (error) {
    console.error('Error updating care user:', error)
    const message = error instanceof Error ? error.message : 'Failed to update care user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/care-users/[userId]
 * Remove Care role from a user (admin only)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

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

    // Remove the Care role (sets role to null)
    await updateCareUserRole(userId, null)

    return NextResponse.json({
      success: true,
      message: 'Care role removed from user',
    })
  } catch (error) {
    console.error('Error removing care user:', error)
    const message = error instanceof Error ? error.message : 'Failed to remove care user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
