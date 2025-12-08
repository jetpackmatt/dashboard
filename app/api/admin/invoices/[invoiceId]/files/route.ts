import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/invoices/[invoiceId]/files
 *
 * Get signed URLs for invoice files (PDF and XLSX)
 */
export async function GET(
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

    // Get invoice details including stored file paths
    const { data: invoice, error } = await adminClient
      .from('invoices_jetpack')
      .select('id, invoice_number, client_id, xlsx_path, pdf_path')
      .eq('id', invoiceId)
      .single()

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Use stored paths if available, otherwise construct from invoice number
    // Format: {client_id}/{invoice_number}/{invoice_number}-details.xlsx
    let xlsPath = invoice.xlsx_path
    let pdfPath = invoice.pdf_path

    // Fallback for invoices without stored paths (matches historical format)
    if (!xlsPath) {
      xlsPath = `${invoice.client_id}/${invoice.invoice_number}/${invoice.invoice_number}-details.xlsx`
      pdfPath = `${invoice.client_id}/${invoice.invoice_number}/${invoice.invoice_number}.pdf`
    }

    const { data: xlsUrl } = await adminClient.storage
      .from('invoices')
      .createSignedUrl(xlsPath, 3600) // 1 hour

    const { data: pdfUrl } = await adminClient.storage
      .from('invoices')
      .createSignedUrl(pdfPath, 3600) // 1 hour

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
