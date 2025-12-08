import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  collectBillingTransactionsByInvoiceIds,
  collectDetailedBillingDataByInvoiceIds,
  applyMarkupsToLineItems,
  generateSummary,
  generateExcelInvoice,
  storeInvoiceFiles,
} from '@/lib/billing/invoice-generator'
import { generatePDFViaSubprocess } from '@/lib/billing/pdf-subprocess'
import {
  runPreflightValidation,
  formatValidationResult,
} from '@/lib/billing/preflight-validation'

/**
 * POST /api/admin/invoices/[invoiceId]/regenerate
 *
 * Regenerate an existing invoice with fresh data and new files.
 * This is useful after:
 * - Markup rule changes
 * - Sync corrections
 * - Data fixes
 *
 * Only draft invoices can be regenerated.
 * Increments the version number to track regenerations.
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

    // Get existing invoice
    const { data: invoice, error: invoiceError } = await adminClient
      .from('invoices_jetpack')
      .select(`
        *,
        client:clients(id, company_name, short_code, billing_email, billing_terms, merchant_id, billing_address)
      `)
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Only allow regeneration of draft invoices
    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot regenerate ${invoice.status} invoice. Only draft invoices can be regenerated.` },
        { status: 400 }
      )
    }

    const client = invoice.client

    // Get ShipBob invoice IDs from the invoice record
    // These are stored at generation time and define exactly which SB invoices are included
    const shipbobInvoiceIds: number[] = invoice.shipbob_invoice_ids || []

    if (shipbobInvoiceIds.length === 0) {
      return NextResponse.json(
        { error: 'No ShipBob invoice IDs found on invoice record. This invoice may need to be re-generated from preflight.' },
        { status: 400 }
      )
    }

    console.log(`Regenerating invoice ${invoice.invoice_number} with ${shipbobInvoiceIds.length} ShipBob invoices`)

    // Step 1: Run pre-flight validation (non-blocking for regeneration)
    // Regeneration should still work even with incomplete shipments table data
    // since the transactions table is the source of truth for billing
    const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds)
    console.log(formatValidationResult(validation))

    if (!validation.passed) {
      console.warn(`[Regenerate] Pre-flight validation has issues for ${invoice.invoice_number}:`, validation.issues.map(i => i.message).join('; '))
      // Continue anyway - validation failures are logged but don't block regeneration
      // This allows regeneration to work even when shipments table is incomplete
    }

    // Step 2: Collect and process line items
    let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds)

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'No transactions found for regeneration' },
        { status: 400 }
      )
    }

    // Step 3: Apply markups
    lineItems = await applyMarkupsToLineItems(client.id, lineItems)

    // Step 4: Generate summary
    const summary = generateSummary(lineItems)

    // Step 5: Calculate storage period (same logic as cron job)
    const parseDateAsLocal = (dateStr: string): Date => {
      if (dateStr.length === 10 && dateStr.includes('-')) {
        const [year, month, day] = dateStr.split('-').map(Number)
        return new Date(year, month - 1, day)
      }
      return new Date(dateStr)
    }

    const storageDates = lineItems
      .filter(item => item.lineCategory === 'Storage')
      .map(item => parseDateAsLocal(item.transactionDate))

    let storagePeriodStart: Date | undefined
    let storagePeriodEnd: Date | undefined

    if (storageDates.length > 0) {
      const minStorageDate = new Date(Math.min(...storageDates.map(d => d.getTime())))
      const maxStorageDate = new Date(Math.max(...storageDates.map(d => d.getTime())))

      const storageMonth = minStorageDate.getMonth()
      const storageYear = minStorageDate.getFullYear()
      const dayMin = minStorageDate.getDate()
      const dayMax = maxStorageDate.getDate()

      if (dayMin <= 15 && dayMax > 15) {
        storagePeriodStart = new Date(storageYear, storageMonth, 1)
        storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
      } else if (dayMax <= 15) {
        storagePeriodStart = new Date(storageYear, storageMonth, 1)
        storagePeriodEnd = new Date(storageYear, storageMonth, 15)
      } else {
        storagePeriodStart = new Date(storageYear, storageMonth, 16)
        storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
      }
    }

    const formatLocalDate = (d: Date): string => {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    // Step 6: Generate new files
    const invoiceData = {
      invoice: {
        ...invoice,
        subtotal: summary.subtotal,
        total_markup: summary.totalMarkup,
        total_amount: summary.totalAmount,
      },
      client: {
        id: client.id,
        company_name: client.company_name,
        short_code: client.short_code,
        billing_email: client.billing_email,
        billing_terms: client.billing_terms || 'due_on_receipt',
        merchant_id: client.merchant_id || null,
      },
      lineItems,
      summary,
    }

    const detailedData = await collectDetailedBillingDataByInvoiceIds(client.id, shipbobInvoiceIds)

    const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
    const pdfBuffer = await generatePDFViaSubprocess(invoiceData, {
      storagePeriodStart: storagePeriodStart ? formatLocalDate(storagePeriodStart) : undefined,
      storagePeriodEnd: storagePeriodEnd ? formatLocalDate(storagePeriodEnd) : undefined,
      clientAddress: client.billing_address || undefined,
    })

    // Step 7: Store new files (upsert will overwrite existing)
    await storeInvoiceFiles(invoice.id, client.id, invoice.invoice_number, xlsBuffer, pdfBuffer)

    // Extract actual ShipBob IDs used (in case lineItems has a different set)
    const actualShipbobIds = [...new Set(
      lineItems
        .map(item => item.invoiceIdSb)
        .filter((id): id is number => id !== null && id !== undefined)
    )]

    // Step 8: Update invoice record with new totals, version, shipbob_invoice_ids, and line_items_json
    // line_items_json stores the calculated markups so approval uses EXACT same amounts as files
    const { error: updateError } = await adminClient
      .from('invoices_jetpack')
      .update({
        subtotal: summary.subtotal,
        total_markup: summary.totalMarkup,
        total_amount: summary.totalAmount,
        version: (invoice.version || 1) + 1,
        generated_at: new Date().toISOString(),
        shipbob_invoice_ids: actualShipbobIds,
        line_items_json: lineItems,
      })
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Error updating invoice:', updateError)
      return NextResponse.json({ error: 'Failed to update invoice record' }, { status: 500 })
    }

    // NOTE: Transactions are NOT marked here - that happens on approval
    // This allows clean regeneration without affecting transaction state

    console.log(`Regenerated invoice ${invoice.invoice_number} (v${(invoice.version || 1) + 1})`)
    console.log(`  Transactions: ${lineItems.length}, ShipBob invoices: ${actualShipbobIds.length}`)

    return NextResponse.json({
      success: true,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        version: (invoice.version || 1) + 1,
        subtotal: summary.subtotal,
        total_markup: summary.totalMarkup,
        total_amount: summary.totalAmount,
        transactions: lineItems.length,
      },
      validation: {
        passed: true,
        warnings: validation.warnings.length,
        summary: validation.summary,
      },
    })
  } catch (error) {
    console.error('Error regenerating invoice:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
