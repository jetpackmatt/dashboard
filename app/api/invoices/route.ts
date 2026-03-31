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
        line_items_json,
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

    // Compute category breakdowns from line_items_json, then strip the raw JSON
    const enriched = (invoices || []).map((inv: Record<string, unknown>) => {
      const items = Array.isArray(inv.line_items_json) ? inv.line_items_json : []
      let catShipping = 0, catAdditional = 0, catReturns = 0, catReceiving = 0, catStorage = 0, catCredits = 0
      for (const item of items) {
        const amt = Number(item.billedAmount) || Number(item.baseAmount) || 0
        switch (item.lineCategory) {
          case 'Shipping': catShipping += amt; break
          case 'Pick Fees': case 'B2B Fees': case 'Additional Services': catAdditional += amt; break
          case 'Returns': catReturns += amt; break
          case 'Receiving': catReceiving += amt; break
          case 'Storage': catStorage += amt; break
          case 'Credits': catCredits += amt; break
        }
      }
      const { line_items_json: _, ...rest } = inv
      return {
        ...rest,
        cat_shipping: Math.round(catShipping * 100) / 100,
        cat_additional: Math.round(catAdditional * 100) / 100,
        cat_returns: Math.round(catReturns * 100) / 100,
        cat_receiving: Math.round(catReceiving * 100) / 100,
        cat_storage: Math.round(catStorage * 100) / 100,
        cat_credits: Math.round(catCredits * 100) / 100,
      }
    })

    return NextResponse.json({
      invoices: enriched,
      isAdmin,
    })
  } catch (error) {
    console.error('Error in invoices GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
