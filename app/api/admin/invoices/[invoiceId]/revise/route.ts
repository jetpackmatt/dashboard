import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/invoices/[invoiceId]/revise
 *
 * Revise an approved/sent invoice by returning it to draft status.
 * This reverses the approval: resets all transaction marks so they
 * can be re-collected on regeneration.
 *
 * After revising:
 * 1. Dispute any problematic transactions (they'll be excluded on regeneration)
 * 2. Click "Regenerate" to rebuild the invoice without disputed transactions
 * 3. Approve the revised invoice
 */
export async function POST(
  request: Request,
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

    // Get the invoice
    const { data: invoice, error: fetchError } = await adminClient
      .from('invoices_jetpack')
      .select('id, invoice_number, status, paid_status, client_id')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.status !== 'approved' && invoice.status !== 'sent') {
      return NextResponse.json(
        { error: `Cannot revise invoice with status: ${invoice.status}. Only approved or sent invoices can be revised.` },
        { status: 400 }
      )
    }

    console.log(`[Revise] Reverting invoice ${invoice.invoice_number} to draft...`)

    // Step 1: Reset invoice-marking fields on transactions
    // NOTE: We do NOT reset base_charge, total_charge, insurance_charge, taxes_charge
    // Those reflect the actual shipping cost (from SFTP sync + markup preview) and are
    // needed for the shipments UI charge display regardless of invoice status.
    const { data: resetTxs, error: resetError } = await adminClient
      .from('transactions')
      .update({
        invoiced_status_jp: false,
        invoice_id_jp: null,
        invoice_date_jp: null,
        markup_applied: null,
        billed_amount: null,
        markup_percentage: null,
        markup_rule_id: null,
        markup_is_preview: true,
        updated_at: new Date().toISOString(),
      })
      .eq('invoice_id_jp', invoice.invoice_number)
      .select('id')

    if (resetError) {
      console.error('[Revise] Error resetting transactions:', resetError)
      return NextResponse.json({ error: 'Failed to reset transactions' }, { status: 500 })
    }

    const transactionsReset = resetTxs?.length || 0
    console.log(`[Revise] Reset ${transactionsReset} transactions`)

    // Step 2: Clear ShipBob invoice marks
    const { error: sbError } = await adminClient
      .from('invoices_sb')
      .update({ jetpack_invoice_id: null })
      .eq('jetpack_invoice_id', invoice.invoice_number)

    if (sbError) {
      console.error('[Revise] Error clearing ShipBob invoice marks:', sbError)
      // Non-fatal — continue
    }

    // Step 3: Reset invoice to draft
    const { data: updatedInvoice, error: updateError } = await adminClient
      .from('invoices_jetpack')
      .update({
        status: 'draft',
        approved_at: null,
        approved_by: null,
        approval_notes: null,
        email_sent_at: null,
        email_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (updateError) {
      console.error('[Revise] Error updating invoice status:', updateError)
      return NextResponse.json({ error: 'Failed to update invoice status' }, { status: 500 })
    }

    console.log(`[Revise] Invoice ${invoice.invoice_number} returned to draft`)

    return NextResponse.json({
      success: true,
      invoice: updatedInvoice,
      transactionsReset,
    })
  } catch (error) {
    console.error('[Revise] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
