import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  collectBillingTransactions,
  collectDetailedBillingData,
  applyMarkupsToLineItems,
  generateSummary,
  generateExcelInvoice,
  generatePDFInvoice,
  storeInvoiceFiles,
  saveLineItems,
} from '@/lib/billing/invoice-generator'

/**
 * POST /api/admin/invoices/generate
 *
 * Generate draft invoices for all clients for the current billing week.
 * Creates invoice records, calculates markups, generates XLS files,
 * and stores them in Supabase Storage.
 */
export async function POST() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Calculate billing period (previous week: Monday to Sunday)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    // This Monday (invoice date)
    const invoiceDate = new Date(today)
    invoiceDate.setDate(today.getDate() - daysToMonday)
    invoiceDate.setHours(0, 0, 0, 0)

    // Previous Monday (period start)
    const periodStart = new Date(invoiceDate)
    periodStart.setDate(invoiceDate.getDate() - 7)

    // Previous Sunday (period end)
    const periodEnd = new Date(invoiceDate)
    periodEnd.setDate(invoiceDate.getDate() - 1)

    // Get all active clients with billing info
    const { data: clients, error: clientsError } = await adminClient
      .from('clients')
      .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms')
      .eq('is_active', true)

    if (clientsError || !clients) {
      console.error('Error fetching clients:', clientsError)
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    const generatedInvoices = []
    const errors = []

    for (const client of clients) {
      if (!client.short_code) {
        errors.push({ client: client.company_name, error: 'No short code configured' })
        continue
      }

      try {
        // Check if invoice already exists for this period
        const { data: existingInvoice } = await adminClient
          .from('invoices_jetpack')
          .select('id')
          .eq('client_id', client.id)
          .eq('period_start', periodStart.toISOString().split('T')[0])
          .eq('version', 1)
          .single()

        if (existingInvoice) {
          errors.push({ client: client.company_name, error: 'Invoice already exists for this period' })
          continue
        }

        // Collect billing transactions for this client
        let lineItems = await collectBillingTransactions(client.id, periodStart, periodEnd)

        if (lineItems.length === 0) {
          errors.push({ client: client.company_name, error: 'No transactions for this period' })
          continue
        }

        // Apply markups using the markup engine
        lineItems = await applyMarkupsToLineItems(client.id, lineItems)

        // Generate summary
        const summary = generateSummary(lineItems)

        // Generate invoice number
        const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-${formatDateForInvoice(invoiceDate)}`

        // Create invoice record
        const { data: invoice, error: invoiceError } = await adminClient
          .from('invoices_jetpack')
          .insert({
            client_id: client.id,
            invoice_number: invoiceNumber,
            invoice_date: invoiceDate.toISOString().split('T')[0],
            period_start: periodStart.toISOString().split('T')[0],
            period_end: periodEnd.toISOString().split('T')[0],
            subtotal: summary.subtotal,
            total_markup: summary.totalMarkup,
            total_amount: summary.totalAmount,
            status: 'draft',
            generated_at: new Date().toISOString(),
            regeneration_locked_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          })
          .select()
          .single()

        if (invoiceError) {
          console.error(`Error creating invoice for ${client.company_name}:`, invoiceError)
          errors.push({ client: client.company_name, error: invoiceError.message })
          continue
        }

        // Generate XLS file
        const invoiceData = {
          invoice,
          client: {
            id: client.id,
            company_name: client.company_name,
            short_code: client.short_code,
            billing_email: client.billing_email,
            billing_terms: client.billing_terms || 'due_on_receipt',
          },
          lineItems,
          summary,
        }

        // Collect detailed data for XLSX (includes all raw fields for 6-sheet format)
        const detailedData = await collectDetailedBillingData(client.id, periodStart, periodEnd)

        const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
        const pdfBuffer = await generatePDFInvoice(invoiceData)

        // Store files in Supabase Storage (both XLSX and PDF)
        await storeInvoiceFiles(invoice.id, client.id, invoiceNumber, xlsBuffer, pdfBuffer)

        // Save line items to database
        await saveLineItems(invoice.id, lineItems)

        // Increment client's next invoice number
        await adminClient
          .from('clients')
          .update({ next_invoice_number: client.next_invoice_number + 1 })
          .eq('id', client.id)

        generatedInvoices.push({
          ...invoice,
          transactionCount: lineItems.length,
        })
      } catch (err) {
        console.error(`Error generating invoice for ${client.company_name}:`, err)
        errors.push({
          client: client.company_name,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({
      success: true,
      generated: generatedInvoices.length,
      errors: errors.length,
      invoices: generatedInvoices,
      errorDetails: errors,
    })
  } catch (error) {
    console.error('Error in invoice generation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper: Format date as MMDDYY
function formatDateForInvoice(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${month}${day}${year}`
}
