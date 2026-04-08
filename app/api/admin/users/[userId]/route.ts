import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * DELETE /api/admin/users/[userId]
 * Permanently delete a user from the platform (admin only).
 * Removes auth user and all user_clients links.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    // Verify caller is authenticated admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    // Prevent self-deletion
    if (userId === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Remove user_clients links first
    await adminClient
      .from('user_clients')
      .delete()
      .eq('user_id', userId)

    // Delete the auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('Error deleting user:', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting user:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
