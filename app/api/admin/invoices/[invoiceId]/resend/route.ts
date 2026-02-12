import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateInvoiceEmail } from '@/lib/email/invoice-templates'
import { sendInvoiceEmail, fetchInvoiceFiles } from '@/lib/email/client'

/**
 * POST /api/admin/invoices/[invoiceId]/resend
 *
 * Manually resend invoice email (admin only)
 *
 * Optional request body:
 * {
 *   to?: string[]  // Override billing_emails if provided (for testing)
 * }
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

    // Get invoice with client info
    const { data: invoice, error: fetchError } = await adminClient
      .from('invoices_jetpack')
      .select('*, client:clients(id, company_name, billing_emails)')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Can only resend approved invoices
    if (invoice.status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot resend invoice with status: ${invoice.status}` },
        { status: 400 }
      )
    }

    // Get optional email override from request body
    const client = invoice.client as { id: string; company_name: string; billing_emails: string[] | null }
    let recipientEmails = client.billing_emails || []

    try {
      const body = await request.json()
      if (body.to && Array.isArray(body.to)) {
        recipientEmails = body.to
      }
    } catch {
      // No body, use default billing_emails
    }

    if (recipientEmails.length === 0) {
      return NextResponse.json(
        { error: 'No billing emails configured for this client' },
        { status: 400 }
      )
    }

    // Validate file paths exist
    if (!invoice.pdf_path || !invoice.xlsx_path) {
      return NextResponse.json(
        { error: 'Invoice files not found' },
        { status: 400 }
      )
    }

    // Fetch invoice files from Storage with security validation
    const { pdfBuffer, xlsxBuffer } = await fetchInvoiceFiles(
      invoice.client_id,
      invoice.pdf_path,
      invoice.xlsx_path
    )

    // Generate email content
    const emailContent = generateInvoiceEmail({
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      clientName: client.company_name,
    })

    // Send email
    await sendInvoiceEmail({
      to: recipientEmails,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      attachments: [
        { filename: `${invoice.invoice_number}.pdf`, content: pdfBuffer },
        { filename: `${invoice.invoice_number}-details.xlsx`, content: xlsxBuffer },
      ],
    })

    // Update email sent timestamp (overwrite previous)
    await adminClient
      .from('invoices_jetpack')
      .update({
        email_sent_at: new Date().toISOString(),
        email_error: null,
      })
      .eq('id', invoiceId)

    console.log(`[Resend Invoice] Email sent for ${invoice.invoice_number} to ${recipientEmails.length} recipient(s)`)

    return NextResponse.json({
      success: true,
      recipients: recipientEmails.length,
    })

  } catch (error) {
    console.error('[Resend Invoice] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
