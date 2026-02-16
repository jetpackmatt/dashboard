import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/admin/invoices - List all invoices
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Fetch recent invoices with client info (including Stripe fields for CC payments)
    // Explicitly select columns to avoid fetching large JSONB columns (line_items_json is ~19MB TOAST data)
    const { data: invoices, error } = await adminClient
      .from('invoices_jetpack')
      .select(`
        id, client_id, invoice_number, invoice_date, period_start, period_end,
        subtotal, total_markup, total_amount, status, version, paid_status,
        paid_at, email_sent_at, email_error, approved_at, approved_by,
        approval_notes, generated_at, created_at, updated_at,
        pdf_path, xlsx_path, stripe_payment_intent_id,
        client:clients(id, company_name, short_code, stripe_customer_id, stripe_payment_method_id)
      `)
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Error fetching invoices:', error)
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
    }

    return NextResponse.json({ invoices: invoices || [] })
  } catch (error) {
    console.error('Error in invoices GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
