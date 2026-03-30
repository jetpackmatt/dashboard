import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/brand_team
 *
 * List team members for the caller's brand.
 * Only brand_owner (or admin) can view the team roster.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null

  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId

    // Only brand_owner or admin/care users can list team members
    if (!access.isAdmin && !access.isCareUser && access.brandRole !== 'brand_owner') {
      return NextResponse.json({ error: 'Only brand owners can manage team members' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  try {
    // Get all user_clients rows for this client
    const { data: teamRows, error: teamError } = await admin
      .from('user_clients')
      .select('user_id, role, permissions, created_at')
      .eq('client_id', clientId)

    if (teamError) {
      console.error('Error fetching team members:', teamError)
      return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 })
    }

    if (!teamRows || teamRows.length === 0) {
      return NextResponse.json({ members: [] })
    }

    // Get user details for each team member via auth admin API
    const members = await Promise.all(
      teamRows.map(async (row: { user_id: string; role: string; permissions: Record<string, boolean> | null; created_at: string }) => {
        const { data: { user }, error: userError } = await admin.auth.admin.getUserById(row.user_id)

        if (userError || !user) {
          return {
            id: row.user_id,
            email: null,
            fullName: null,
            role: row.role,
            permissions: row.permissions,
            status: 'unknown',
            createdAt: row.created_at,
          }
        }

        return {
          id: row.user_id,
          email: user.email,
          fullName: user.user_metadata?.full_name || null,
          role: row.role,
          permissions: row.permissions,
          status: user.email_confirmed_at ? 'active' : 'invited',
          createdAt: row.created_at,
        }
      })
    )

    return NextResponse.json({ members })
  } catch (error) {
    console.error('Error listing team members:', error)
    return NextResponse.json({ error: 'Failed to list team members' }, { status: 500 })
  }
}
