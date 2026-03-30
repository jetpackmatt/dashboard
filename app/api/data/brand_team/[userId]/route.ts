import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/data/brand_team/[userId]
 *
 * Update a team member's role or permissions.
 * Only brand_owner (or admin) can modify team members.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
    const body = await request.json()
    const { client_id, role, permissions } = body

    // Verify caller has access to this client
    let clientId: string | null
    try {
      const access = await verifyClientAccess(client_id)
      clientId = access.requestedClientId

      // Only brand_owner or admin can update team members
      if (!access.isAdmin && !access.isCareUser && access.brandRole !== 'brand_owner') {
        return NextResponse.json({ error: 'Only brand owners can update team members' }, { status: 403 })
      }
    } catch (error) {
      return handleAccessError(error)
    }

    if (!clientId) {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
    }

    // Validate role
    const validRoles = ['brand_owner', 'brand_team'] as const
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be brand_owner or brand_team' }, { status: 400 })
    }

    // Get the caller's user id to prevent self-demotion
    const supabase = await createClient()
    const { data: { user: caller } } = await supabase.auth.getUser()

    if (!caller) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Prevent self-demotion from brand_owner
    if (userId === caller.id && role && role !== 'brand_owner') {
      return NextResponse.json(
        { error: 'You cannot demote yourself. Ask another brand owner to change your role.' },
        { status: 400 }
      )
    }

    // Verify target user is actually a member of this client
    const admin = createAdminClient()
    const { data: existingRow, error: fetchError } = await admin
      .from('user_clients')
      .select('id, role')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .single()

    if (fetchError || !existingRow) {
      return NextResponse.json({ error: 'Team member not found for this client' }, { status: 404 })
    }

    // Build update payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {}

    if (role) {
      update.role = role
      // brand_owner has no permissions (implicit full access)
      if (role === 'brand_owner') {
        update.permissions = null
      } else if (role === 'brand_team') {
        // brand_team requires permissions
        if (!permissions) {
          return NextResponse.json(
            { error: 'Permissions are required when setting role to brand_team' },
            { status: 400 }
          )
        }
        update.permissions = permissions
      }
    } else if (permissions) {
      // Only updating permissions (no role change)
      // Only valid if current role is brand_team
      if (existingRow.role === 'brand_owner') {
        return NextResponse.json(
          { error: 'Cannot set permissions on a brand_owner. Change role to brand_team first.' },
          { status: 400 }
        )
      }
      update.permissions = permissions
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update. Provide role and/or permissions.' }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from('user_clients')
      .update(update)
      .eq('user_id', userId)
      .eq('client_id', clientId)

    if (updateError) {
      console.error('Error updating team member:', updateError)
      return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating team member:', error)
    const message = error instanceof Error ? error.message : 'Failed to update team member'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/data/brand_team/[userId]
 *
 * Remove a team member from the brand.
 * Only brand_owner (or admin) can remove team members.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
    const searchParams = request.nextUrl.searchParams

    // Verify caller has access to this client
    let clientId: string | null
    try {
      const access = await verifyClientAccess(searchParams.get('clientId'))
      clientId = access.requestedClientId

      // Only brand_owner or admin can remove team members
      if (!access.isAdmin && !access.isCareUser && access.brandRole !== 'brand_owner') {
        return NextResponse.json({ error: 'Only brand owners can remove team members' }, { status: 403 })
      }
    } catch (error) {
      return handleAccessError(error)
    }

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }

    // Get the caller's user id to prevent self-removal
    const supabase = await createClient()
    const { data: { user: caller } } = await supabase.auth.getUser()

    if (!caller) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (userId === caller.id) {
      return NextResponse.json(
        { error: 'You cannot remove yourself from the team.' },
        { status: 400 }
      )
    }

    // Verify target user is actually a member of this client
    const admin = createAdminClient()
    const { data: existingRow, error: fetchError } = await admin
      .from('user_clients')
      .select('id')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .single()

    if (fetchError || !existingRow) {
      return NextResponse.json({ error: 'Team member not found for this client' }, { status: 404 })
    }

    // Delete the user_clients row
    const { error: deleteError } = await admin
      .from('user_clients')
      .delete()
      .eq('user_id', userId)
      .eq('client_id', clientId)

    if (deleteError) {
      console.error('Error removing team member:', deleteError)
      return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 })
    }

    // If user has no remaining client associations, delete the Auth user entirely
    const { count: remainingClients } = await admin
      .from('user_clients')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (remainingClients === 0) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
      if (authDeleteError) {
        console.error('Error deleting auth user (user_clients already removed):', authDeleteError)
        // Don't fail the request — the user_clients row is already gone
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing team member:', error)
    const message = error instanceof Error ? error.message : 'Failed to remove team member'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
