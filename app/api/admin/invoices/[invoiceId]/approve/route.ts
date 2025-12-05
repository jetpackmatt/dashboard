import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/invoices/[invoiceId]/approve
 *
 * Approve a draft invoice, making it final.
 * TODO: This will trigger PDF/XLS generation and email sending.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params

    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get current invoice
    const { data: invoice, error: fetchError } = await adminClient
      .from('invoices_jetpack')
      .select('*')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot approve invoice with status: ${invoice.status}` },
        { status: 400 }
      )
    }

    // Get optional approval notes from request body
    let approvalNotes = null
    try {
      const body = await request.json()
      approvalNotes = body.notes || null
    } catch {
      // No body provided, that's fine
    }

    // Update invoice to approved
    const { data: updatedInvoice, error: updateError } = await adminClient
      .from('invoices_jetpack')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        approval_notes: approvalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (updateError) {
      console.error('Error approving invoice:', updateError)
      return NextResponse.json({ error: 'Failed to approve invoice' }, { status: 500 })
    }

    // TODO: Generate PDF and XLS
    // TODO: Send email to client

    return NextResponse.json({
      success: true,
      invoice: updatedInvoice,
    })
  } catch (error) {
    console.error('Error in invoice approval:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
