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
  const { data: userClients } = await admin
    .from('user_clients')
    .select('client_id, clients(company_name)')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  const companyName = (userClients as any)?.clients?.company_name || null

  return NextResponse.json({ companyName })
}
