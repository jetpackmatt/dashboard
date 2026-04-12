import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient, getClientsWithTokenStatus, isAdminRole, isCareRole, hasAllClientsAccess } from '@/lib/supabase/admin'

/**
 * GET /api/auth/clients
 * Unified client endpoint for ALL user types.
 * - Admin/Care users: returns all clients with token status
 * - Brand users: returns only their linked clients from user_clients table
 * Returns role flags so the frontend can adjust UI accordingly.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userRole = user.user_metadata?.role
    const isAdmin = isAdminRole(userRole)
    const isCareUser = isCareRole(userRole)

    // Admin and care users: return all clients
    if (hasAllClientsAccess(userRole)) {
      const clients = await getClientsWithTokenStatus()
      return NextResponse.json({
        clients,
        count: clients.length,
        isAdmin,
        isCareUser,
        userRole,
      })
    }

    // Brand users: return only their linked clients
    const admin = createAdminClient()
    const { data: userClientRows, error } = await admin
      .from('user_clients')
      .select('client_id, role, permissions, clients(company_name, merchant_id, eshipper_id, gofo_id, short_code, is_demo)')
      .eq('user_id', user.id)

    if (error) {
      console.error('Failed to fetch user clients:', error)
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    const clients = (userClientRows || []).map((row: any) => ({
      id: row.client_id,
      company_name: row.clients?.company_name || '',
      merchant_id: row.clients?.merchant_id || null,
      eshipper_id: row.clients?.eshipper_id || null,
      gofo_id: row.clients?.gofo_id || null,
      short_code: row.clients?.short_code || null,
      has_token: false,
      is_demo: row.clients?.is_demo || false,
    }))

    return NextResponse.json({
      clients,
      count: clients.length,
      isAdmin: false,
      isCareUser: false,
      userRole: undefined,
      brandRole: (userClientRows as any)?.[0]?.role || null,
      permissions: (userClientRows as any)?.[0]?.permissions || null,
    })
  } catch (error) {
    console.error('Error fetching clients:', error)
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
  }
}
