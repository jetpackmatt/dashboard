import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/data/user/brand
 * Returns the current user's company name from user_clients → clients.
 * Used by brand users who don't have access to /api/admin/clients.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: userClientRows } = await admin
    .from('user_clients')
    .select('client_id, role, clients(company_name, merchant_id, eshipper_id, gofo_id, short_code)')
    .eq('user_id', user.id)

  const clients = (userClientRows || []).map((row: any) => ({
    id: row.client_id,
    company_name: row.clients?.company_name || '',
    merchant_id: row.clients?.merchant_id || null,
    eshipper_id: row.clients?.eshipper_id || null,
    gofo_id: row.clients?.gofo_id || null,
    short_code: row.clients?.short_code || null,
    has_token: false,
    role: row.role,
  }))

  // Backwards compat: still include companyName
  const companyName = clients[0]?.company_name || null

  return NextResponse.json({ companyName, clients })
}
