import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError, inviteUser } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions'

/**
 * POST /api/data/brand_team/invite
 *
 * Brand-owner invites a team member to their brand.
 * Creates/invites the user and links them to the client with the specified role and permissions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, client_id, role, permissions, full_name } = body

    // Verify caller has access to this client
    let clientId: string | null
    try {
      const access = await verifyClientAccess(client_id)
      clientId = access.requestedClientId

      // Only brand_owner or admin can invite team members
      if (!access.isAdmin && !access.isCareUser && access.brandRole !== 'brand_owner') {
        return NextResponse.json({ error: 'Only brand owners can invite team members' }, { status: 403 })
      }
    } catch (error) {
      return handleAccessError(error)
    }

    if (!clientId) {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
    }

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    // Validate role
    const validRoles = ['brand_owner', 'brand_team'] as const
    const userRole = validRoles.includes(role) ? role : 'brand_team'

    // brand_team must have permissions
    const userPermissions = userRole === 'brand_team'
      ? (permissions || DEFAULT_PERMISSIONS)
      : null

    // Get the caller's user id for invited_by
    const supabase = await createClient()
    const { data: { user: caller } } = await supabase.auth.getUser()

    if (!caller) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Invite the user
    const result = await inviteUser({
      email: email.trim().toLowerCase(),
      clientId,
      role: userRole,
      permissions: userPermissions,
      fullName: full_name?.trim(),
      invitedBy: caller.id,
    })

    // If brand_team and custom permissions were provided, update the row
    // (inviteUser already sets permissions, but if caller provided specific ones, ensure they stick)
    if (userRole === 'brand_team' && permissions) {
      const admin = createAdminClient()
      await admin
        .from('user_clients')
        .update({ permissions })
        .eq('user_id', result.user.id)
        .eq('client_id', clientId)
    }

    return NextResponse.json(
      {
        success: true,
        user: result.user,
        message: `Invitation sent to ${email}`,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error inviting team member:', error)
    const message = error instanceof Error ? error.message : 'Failed to invite team member'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
