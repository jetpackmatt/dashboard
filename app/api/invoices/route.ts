import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient, isCareRole } from '@/lib/supabase/admin'

/**
 * GET /api/invoices
 *
 * Get invoices for the current user.
 * - Admins can see all invoices (or filter by client_id query param)
 * - Care users (care_admin, care_team) can see all invoices
 * - Regular users can only see invoices for their associated clients
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const userRole = user.user_metadata?.role
    const isAdmin = userRole === 'admin'
    const isCareUser = isCareRole(userRole)

    // Get client_id filter from query params (for admin/care user filtering)
    const clientId = request.nextUrl.searchParams.get('client_id')

    let query = adminClient
      .from('invoices_jetpack')
      .select(`
        id,
        client_id,
        invoice_number,
        invoice_date,
        period_start,
        period_end,
        subtotal,
        total_markup,
        total_amount,
        status,
        paid_status,
        generated_at,
        approved_at,
        version,
        pdf_path,
        xlsx_path,
        shipment_count,
        transaction_count,
        client:clients(id, company_name, short_code)
      `)
      .in('status', ['approved', 'sent'])
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (isAdmin || isCareUser) {
      // Admin and care users can filter by specific client or see all
      if (clientId) {
        query = query.eq('client_id', clientId)
      }
    } else {
      // Non-admin, non-care: get their client memberships first
      const { data: memberships, error: membershipError } = await adminClient
        .from('user_clients')
        .select('client_id')
        .eq('user_id', user.id)

      if (membershipError || !memberships || memberships.length === 0) {
        // User has no client access
        return NextResponse.json({ invoices: [], isAdmin: false })
      }

      const clientIds = memberships.map((m: { client_id: string }) => m.client_id)
      query = query.in('client_id', clientIds)
    }

    const { data: invoices, error } = await query.limit(200)

    if (error) {
      console.error('Error fetching invoices:', error)
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
    }

    return NextResponse.json({
      invoices: invoices || [],
      isAdmin,
    })
  } catch (error) {
    console.error('Error in invoices GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
