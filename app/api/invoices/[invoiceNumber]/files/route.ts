import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient, isCareRole } from '@/lib/supabase/admin'

/**
 * GET /api/invoices/[invoiceNumber]/files
 *
 * Get signed URLs for invoice files (PDF and XLSX) by invoice number.
 * This is the client-facing endpoint (non-admin).
 *
 * Users can only access invoices for their own clients.
 * Admins and Care users can access all invoices.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceNumber: string }> }
) {
  try {
    const { invoiceNumber } = await params

    // Get current user and their client access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get invoice by invoice_number
    const { data: invoice, error } = await adminClient
      .from('invoices_jetpack')
      .select('id, invoice_number, client_id, xlsx_path, pdf_path')
      .eq('invoice_number', invoiceNumber)
      .single()

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // For non-admin, non-care users, verify they have access to this client
    const userRole = user.user_metadata?.role
    const isAdmin = userRole === 'admin'
    const isCareUser = isCareRole(userRole)

    if (!isAdmin && !isCareUser) {
      // Check if user has access to this client
      const { data: membership } = await adminClient
        .from('user_clients')
        .select('id')
        .eq('user_id', user.id)
        .eq('client_id', invoice.client_id)
        .single()

      if (!membership) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }
    }

    // Use stored paths if available, otherwise construct from invoice number
    let xlsPath = invoice.xlsx_path
    let pdfPath = invoice.pdf_path

    // Fallback for invoices without stored paths
    if (!xlsPath) {
      xlsPath = `${invoice.client_id}/${invoice.invoice_number}/${invoice.invoice_number}-details.xlsx`
      pdfPath = `${invoice.client_id}/${invoice.invoice_number}/${invoice.invoice_number}.pdf`
    }

    const { data: xlsUrl } = await adminClient.storage
      .from('invoices')
      .createSignedUrl(xlsPath, 3600) // 1 hour

    const { data: pdfUrl } = await adminClient.storage
      .from('invoices')
      .createSignedUrl(pdfPath || '', 3600) // 1 hour

    return NextResponse.json({
      xlsUrl: xlsUrl?.signedUrl || null,
      pdfUrl: pdfUrl?.signedUrl || null,
      invoiceNumber: invoice.invoice_number,
    })
  } catch (error) {
    console.error('Error getting invoice files:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
