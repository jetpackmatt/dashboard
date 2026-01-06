import { NextResponse } from 'next/server'
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
  type ValidationResult,
} from '@/lib/billing/preflight-validation'

/**
 * GET /api/cron/generate-invoices
 *
 * Vercel Cron Job: Runs every Monday at 5am PT (12pm UTC)
 * Generates draft invoices for all clients based on unprocessed ShipBob invoices.
 *
 * Source of truth: invoices_sb.jetpack_invoice_id IS NULL
 *
 * Flow:
 * 1. Get all active clients
 * 2. Get ALL unprocessed ShipBob invoices (PARENT TOKEN level - shared across clients)
 * 3. For each client: collect transactions by invoice_id_sb AND client_id
 * 4. Generate Jetpack invoice (PDF + XLSX)
 * 5. After all clients processed: mark ShipBob invoices with Jetpack invoice number(s)
 *
 * NOTE: SFTP shipping breakdown is now synced daily by /api/cron/sync-sftp-costs
 * (runs at 5 AM EST daily, updating base_cost/surcharge/surcharge_details)
 *
 * Cron schedule: 0 12 * * 1 (every Monday at 12:00 UTC = 5am PT)
 */
export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max for invoice generation

export async function GET(request: Request) {
  try {
    // Verify this is a Vercel cron request
    const authHeader = request.headers.get('authorization')

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('Starting scheduled invoice generation...')

    const adminClient = createAdminClient()

    // Calculate invoice date (this Monday)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    const invoiceDate = new Date(today)
    invoiceDate.setDate(today.getDate() - daysToMonday)
    invoiceDate.setHours(0, 0, 0, 0)

    console.log(`Invoice date: ${invoiceDate.toISOString().split('T')[0]}`)

    // NOTE: SFTP breakdown data is now synced daily by /api/cron/sync-sftp-costs
    // No need to fetch here - transactions already have base_cost/surcharge populated

    // Step 1: Get all active clients with billing info (exclude internal/system entries)
    const { data: clients, error: clientsError } = await adminClient
      .from('clients')
      .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms, merchant_id, billing_address')
      .eq('is_active', true)
      .or('is_internal.is.null,is_internal.eq.false')

    if (clientsError || !clients) {
      console.error('Error fetching clients:', clientsError)
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    // Step 2: Get ALL unprocessed ShipBob invoices (PARENT TOKEN level - shared across clients)
    // Source of truth: invoices_sb.jetpack_invoice_id IS NULL
    // Exclude Payment type (not billable)
    const { data: unprocessedInvoices, error: invoicesError } = await adminClient
      .from('invoices_sb')
      .select('id, shipbob_invoice_id, invoice_type, base_amount')
      .is('jetpack_invoice_id', null)
      .neq('invoice_type', 'Payment')
      .order('invoice_date', { ascending: true })

    if (invoicesError) {
      console.error('Error fetching unprocessed invoices:', invoicesError)
      return NextResponse.json({ error: 'Failed to fetch unprocessed invoices' }, { status: 500 })
    }

    if (!unprocessedInvoices || unprocessedInvoices.length === 0) {
      console.log('No unprocessed ShipBob invoices found')
      return NextResponse.json({
        success: true,
        generated: 0,
        errors: 0,
        invoices: [],
        errorDetails: [],
        message: 'No unprocessed ShipBob invoices'
      })
    }

    // Extract ShipBob invoice IDs (shipbob_invoice_id is TEXT, convert to INTEGER for transactions query)
    const shipbobInvoiceIds = unprocessedInvoices
      .map((inv: { shipbob_invoice_id: string }) => parseInt(inv.shipbob_invoice_id, 10))
      .filter((id: number): id is number => !isNaN(id))

    console.log(`Found ${unprocessedInvoices.length} unprocessed ShipBob invoices`)
    console.log(`  Invoice IDs: ${shipbobInvoiceIds.join(', ')}`)
    console.log(`  Types: ${[...new Set(unprocessedInvoices.map((i: { invoice_type: string }) => i.invoice_type))].join(', ')}`)

    const generatedInvoices: Array<{ invoiceNumber: string; client: string; total: number; transactions: number }> = []
    const errors: Array<{ client: string; error: string }> = []
    const validationResults: Array<{ client: string; validation: ValidationResult }> = []

    for (const client of clients) {
      if (!client.short_code) {
        errors.push({ client: client.company_name, error: 'No short code configured' })
        continue
      }

      try {
        // Step 3: Collect billing transactions by ShipBob invoice IDs AND client_id
        // ShipBob invoices are shared across clients, but transactions are per-client
        let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds)

        if (lineItems.length === 0) {
          console.log(`No transactions for ${client.company_name} in this week's invoices, skipping`)
          continue
        }

        console.log(`Processing ${lineItems.length} transactions for ${client.company_name}`)

        // Step 3.5: Run pre-flight validation
        console.log(`Running pre-flight validation for ${client.company_name}...`)
        const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds)
        validationResults.push({ client: client.company_name, validation })

        console.log(formatValidationResult(validation))

        if (!validation.passed) {
          // Critical issues block invoice generation
          console.error(`❌ Pre-flight validation FAILED for ${client.company_name}`)
          errors.push({
            client: client.company_name,
            error: `Pre-flight validation failed: ${validation.issues.map(i => i.message).join('; ')}`
          })
          continue
        }

        console.log(`✅ Pre-flight validation passed for ${client.company_name}`)

        // Extract the actual ShipBob invoice IDs used for this client's transactions
        // (subset of the global shipbobInvoiceIds that have transactions for this client)
        const clientShipbobIds = [...new Set(
          lineItems
            .map(item => item.invoiceIdSb)
            .filter((id): id is number => id !== null && id !== undefined)
        )]

        // Step 4: Apply markups using the markup engine
        lineItems = await applyMarkupsToLineItems(client.id, lineItems)

        // Step 5: Generate summary
        const summary = generateSummary(lineItems)

        // Calculate billing period: prior Monday through Sunday (NOT from transaction dates)
        // Invoice date = Monday, billing period = prior week Mon-Sun
        const periodEnd = new Date(invoiceDate)
        periodEnd.setDate(periodEnd.getDate() - 1) // Sunday before invoice date
        const periodStart = new Date(periodEnd)
        periodStart.setDate(periodStart.getDate() - 6) // Monday of prior week

        // Calculate storage period separately (rounded to half-month)
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

          // Round to half-month boundaries
          if (dayMin <= 15 && dayMax > 15) {
            // Full month
            storagePeriodStart = new Date(storageYear, storageMonth, 1)
            storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
          } else if (dayMax <= 15) {
            // First half
            storagePeriodStart = new Date(storageYear, storageMonth, 1)
            storagePeriodEnd = new Date(storageYear, storageMonth, 15)
          } else {
            // Second half
            storagePeriodStart = new Date(storageYear, storageMonth, 16)
            storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
          }
        }

        // Helper to format dates as YYYY-MM-DD in local time
        const formatLocalDate = (d: Date): string => {
          const year = d.getFullYear()
          const month = String(d.getMonth() + 1).padStart(2, '0')
          const day = String(d.getDate()).padStart(2, '0')
          return `${year}-${month}-${day}`
        }

        // Step 6: Generate invoice number
        const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-${formatDateForInvoice(invoiceDate)}`

        // Check if invoice already exists (duplicate prevention)
        const { data: existingInvoice } = await adminClient
          .from('invoices_jetpack')
          .select('id')
          .eq('invoice_number', invoiceNumber)
          .single()

        if (existingInvoice) {
          console.log(`Invoice ${invoiceNumber} already exists for ${client.company_name}, skipping`)
          continue
        }

        // Step 7: Create Jetpack invoice record
        // Store shipbob_invoice_ids and line_items_json for the approval workflow
        // - shipbob_invoice_ids: Used for regeneration
        // - line_items_json: Used at approval to mark transactions with EXACT same amounts as files
        // Transactions are NOT marked here - that happens on approval
        const { data: invoice, error: invoiceError } = await adminClient
          .from('invoices_jetpack')
          .insert({
            client_id: client.id,
            invoice_number: invoiceNumber,
            invoice_date: formatLocalDate(invoiceDate),
            period_start: formatLocalDate(periodStart),
            period_end: formatLocalDate(periodEnd),
            subtotal: summary.subtotal,
            total_markup: summary.totalMarkup,
            total_amount: summary.totalAmount,
            status: 'draft',
            generated_at: new Date().toISOString(),
            regeneration_locked_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            shipbob_invoice_ids: clientShipbobIds,
            line_items_json: lineItems,
          })
          .select()
          .single()

        if (invoiceError) {
          console.error(`Error creating invoice for ${client.company_name}:`, invoiceError)
          errors.push({ client: client.company_name, error: invoiceError.message })
          continue
        }

        // Step 8: Generate files
        const invoiceData = {
          invoice,
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

        // Collect detailed data for XLSX (by same invoice IDs)
        const detailedData = await collectDetailedBillingDataByInvoiceIds(client.id, shipbobInvoiceIds)

        const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
        const pdfBuffer = await generatePDFViaSubprocess(invoiceData, {
          storagePeriodStart: storagePeriodStart ? formatLocalDate(storagePeriodStart) : undefined,
          storagePeriodEnd: storagePeriodEnd ? formatLocalDate(storagePeriodEnd) : undefined,
          clientAddress: client.billing_address || undefined,
        })

        // Step 9: Store files in Supabase Storage
        await storeInvoiceFiles(invoice.id, client.id, invoiceNumber, xlsBuffer, pdfBuffer)

        // NOTE: Transactions are NOT marked as invoiced here anymore.
        // That happens when the invoice is APPROVED (not generated).
        // This allows clean regeneration and deletion of drafts.

        // Step 10: Increment client's next invoice number
        await adminClient
          .from('clients')
          .update({ next_invoice_number: client.next_invoice_number + 1 })
          .eq('id', client.id)

        console.log(`Generated invoice ${invoiceNumber} for ${client.company_name}`)

        generatedInvoices.push({
          invoiceNumber,
          client: client.company_name,
          total: summary.totalAmount,
          transactions: lineItems.length,
        })
      } catch (err) {
        console.error(`Error generating invoice for ${client.company_name}:`, err)
        errors.push({
          client: client.company_name,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    // NOTE: ShipBob invoices (invoices_sb) are NOT marked as processed here anymore.
    // That happens when invoices are APPROVED, not generated.
    // This allows the same SB invoices to appear in preflight for regeneration.

    console.log(`Invoice generation complete: ${generatedInvoices.length} generated, ${errors.length} errors`)

    return NextResponse.json({
      success: true,
      generated: generatedInvoices.length,
      errors: errors.length,
      invoices: generatedInvoices,
      errorDetails: errors,
      shipbobInvoicesAvailable: unprocessedInvoices.length,
      preflightValidation: validationResults.map(v => ({
        client: v.client,
        passed: v.validation.passed,
        issues: v.validation.issues.length,
        warnings: v.validation.warnings.length,
        summary: v.validation.summary,
      })),
    })
  } catch (error) {
    console.error('Error in cron invoice generation:', error)
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
