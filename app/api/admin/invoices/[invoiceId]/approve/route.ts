import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  markTransactionsAsInvoiced,
  type InvoiceLineItem,
} from '@/lib/billing/invoice-generator'

/**
 * POST /api/admin/invoices/[invoiceId]/approve
 *
 * Approve a draft invoice, making it final.
 *
 * IMPORTANT: This does NOT recalculate markups. It reads the pre-calculated
 * line_items_json that was stored during generation. This ensures the amounts
 * marked on transactions are EXACTLY what was shown in the PDF/XLS files
 * that were reviewed.
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

    // Get current invoice with client info
    const { data: invoice, error: fetchError } = await adminClient
      .from('invoices_jetpack')
      .select('*, client:clients(id, company_name, short_code)')
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

    // Get cached line items from generation - these are the EXACT amounts shown in PDF/XLS
    const lineItems: InvoiceLineItem[] = invoice.line_items_json || []
    const shipbobInvoiceIds: number[] = invoice.shipbob_invoice_ids || []

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'No cached line items found. This invoice may need to be regenerated.' },
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

    const client = invoice.client
    console.log(`Approving invoice ${invoice.invoice_number} for ${client.company_name}`)
    console.log(`  Using ${lineItems.length} cached line items (no recalculation)`)

    // Step 1: Mark transactions as invoiced using cached markup data
    // Pass invoice_date so transactions have the proper invoice date recorded
    const markResult = await markTransactionsAsInvoiced(lineItems, invoice.invoice_number, invoice.invoice_date)
    console.log(`  Marked ${markResult.updated} transactions`)
    if (markResult.errors.length > 0) {
      console.warn(`  Errors marking transactions:`, markResult.errors.slice(0, 5))
    }

    // Step 2: Mark ShipBob invoices (invoices_sb) with this Jetpack invoice number
    const { error: sbMarkError } = await adminClient
      .from('invoices_sb')
      .update({ jetpack_invoice_id: invoice.invoice_number })
      .in('shipbob_invoice_id', shipbobInvoiceIds.map(String))

    if (sbMarkError) {
      console.error('Error marking ShipBob invoices:', sbMarkError)
      // Don't fail the approval, but log it
    } else {
      console.log(`  Marked ${shipbobInvoiceIds.length} ShipBob invoices as processed`)
    }

    // Step 3: Update invoice to approved
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

    console.log(`Invoice ${invoice.invoice_number} approved successfully`)

    return NextResponse.json({
      success: true,
      invoice: updatedInvoice,
      transactionsMarked: markResult.updated,
      shipbobInvoicesMarked: shipbobInvoiceIds.length,
    })
  } catch (error) {
    console.error('Error in invoice approval:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
