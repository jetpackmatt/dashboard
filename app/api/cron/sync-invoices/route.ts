import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ShipBobClient, type ShipBobInvoice } from '@/lib/shipbob/client'
import {
  fetchShippingBreakdown,
  updateTransactionsWithBreakdown,
} from '@/lib/billing/sftp-client'
import {
  runPreflightValidation,
  formatValidationResult,
  type ValidationResult,
} from '@/lib/billing/preflight-validation'

/**
 * GET /api/cron/sync-invoices
 *
 * Vercel Cron Job: Runs every Monday at 6:30pm PT (1:30am Tuesday UTC)
 *
 * This route syncs new ShipBob invoices, SFTP breakdown, and runs preflight validation.
 * It does NOT generate invoices - that's a manual step in the Admin UI.
 *
 * Flow:
 * 1. Fetch new invoices from ShipBob API and upsert into invoices_sb
 * 1.5. Link transactions to invoices via /invoices/{id}/transactions API
 *      (This is critical - updates transactions.invoice_id_sb so preflight can find them)
 * 2. Fetch SFTP shipping breakdown (if available)
 * 3. Update transactions with breakdown data
 * 4. Get all active clients
 * 5. Get ALL unprocessed ShipBob invoices
 * 6. For each client: run preflight validation
 * 7. Return results for admin review
 *
 * After this runs, an admin:
 * 1. Reviews preflight results in Admin UI
 * 2. Manually clicks "Generate Invoices" to create drafts
 * 3. Reviews drafts, downloads PDF/XLS
 * 4. Approves (which marks transactions)
 */
export const runtime = 'nodejs'
export const maxDuration = 120 // 2 minutes - just sync, no generation

export async function GET(request: Request) {
  try {
    // Verify this is a Vercel cron request
    const authHeader = request.headers.get('authorization')

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('Starting invoice sync (preflight only)...')

    const adminClient = createAdminClient()

    // Calculate invoice date (this Monday)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    const invoiceDate = new Date(today)
    invoiceDate.setDate(today.getDate() - daysToMonday)
    invoiceDate.setHours(0, 0, 0, 0)

    console.log(`Invoice date: ${invoiceDate.toISOString().split('T')[0]}`)

    // Step 1: Fetch new invoices from ShipBob API
    console.log('Fetching invoices from ShipBob API...')
    const invoiceSyncStats = { fetched: 0, inserted: 0, existing: 0, errors: 0 }
    const transactionLinkStats = { linked: 0, notFound: 0, invoicesProcessed: 0 }

    try {
      const shipbob = new ShipBobClient()

      // Fetch invoices from last 30 days to ensure we catch any new ones
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const allInvoices: ShipBobInvoice[] = []
      let cursor: string | undefined

      // Paginate through all invoices
      do {
        const response = await shipbob.billing.getInvoices({
          startDate: thirtyDaysAgo.toISOString().split('T')[0],
          pageSize: 100,
          cursor,
        })

        const items = response.items || []
        allInvoices.push(...items)
        cursor = response.next
      } while (cursor)

      console.log(`  Fetched ${allInvoices.length} invoices from ShipBob API`)
      invoiceSyncStats.fetched = allInvoices.length

      // Get existing invoice IDs from database
      const { data: existingInvoices } = await adminClient
        .from('invoices_sb')
        .select('shipbob_invoice_id')

      const existingIds = new Set((existingInvoices || []).map((inv: { shipbob_invoice_id: string }) => inv.shipbob_invoice_id))

      // Filter to only new invoices
      const newInvoices = allInvoices.filter(inv => !existingIds.has(String(inv.invoice_id)))
      invoiceSyncStats.existing = allInvoices.length - newInvoices.length

      if (newInvoices.length > 0) {
        console.log(`  Found ${newInvoices.length} new invoices to insert`)

        // Calculate period dates (invoice covers prior week Mon-Sun)
        const getInvoicePeriod = (invoiceDateStr: string) => {
          const invDate = new Date(invoiceDateStr)
          // Period end is Sunday before invoice date
          const periodEnd = new Date(invDate)
          periodEnd.setDate(periodEnd.getDate() - 1)
          // Period start is Monday of that week
          const periodStart = new Date(periodEnd)
          periodStart.setDate(periodStart.getDate() - 6)
          return { periodStart, periodEnd }
        }

        // Prepare records for insert
        const records = newInvoices.map(inv => {
          const { periodStart, periodEnd } = getInvoicePeriod(inv.invoice_date)
          return {
            shipbob_invoice_id: String(inv.invoice_id),
            invoice_date: inv.invoice_date,
            invoice_type: inv.invoice_type,
            base_amount: inv.amount,
            currency_code: inv.currency_code || 'USD',
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            raw_data: inv,
          }
        })

        // Insert new invoices
        const { error: insertError } = await adminClient
          .from('invoices_sb')
          .insert(records)

        if (insertError) {
          console.error('Error inserting invoices:', insertError)
          invoiceSyncStats.errors = newInvoices.length
        } else {
          invoiceSyncStats.inserted = newInvoices.length
          console.log(`  Inserted ${newInvoices.length} new invoices into invoices_sb`)
          newInvoices.forEach(inv => {
            console.log(`    - ${inv.invoice_id}: ${inv.invoice_type}, ${inv.invoice_date}, $${inv.amount}`)
          })
        }
      } else {
        console.log('  No new invoices to insert')
      }

      // Step 1.5: Link transactions to invoices via /invoices/{id}/transactions API
      // This updates transactions.invoice_id_sb for all transactions in each invoice
      // Skip Payment invoices as they don't have transactions
      const invoicesToLink = allInvoices.filter(inv => inv.invoice_type !== 'Payment')

      console.log(`Linking transactions to ${invoicesToLink.length} invoices...`)
      transactionLinkStats.invoicesProcessed = invoicesToLink.length

      for (const invoice of invoicesToLink) {
        try {
          // Use /invoices/{id}/transactions endpoint with pagination
          const invoiceTransactions = await shipbob.billing.getTransactionsByInvoice(invoice.invoice_id)

          if (invoiceTransactions.length === 0) {
            continue
          }

          // Get transaction IDs from this invoice
          const transactionIds = invoiceTransactions.map(tx => tx.transaction_id)

          // Batch update in chunks of 500 (Supabase .in() has limits)
          const BATCH_SIZE = 500
          let totalLinked = 0
          let totalErrors = 0

          for (let i = 0; i < transactionIds.length; i += BATCH_SIZE) {
            const batch = transactionIds.slice(i, i + BATCH_SIZE)

            const { data: updated, error: updateError } = await adminClient
              .from('transactions')
              .update({
                invoice_id_sb: invoice.invoice_id,
                invoice_date_sb: invoice.invoice_date,
                invoiced_status_sb: true
              })
              .in('transaction_id', batch)
              .select('id')

            if (updateError) {
              console.error(`  Error linking batch ${Math.floor(i / BATCH_SIZE) + 1} for invoice ${invoice.invoice_id}:`, updateError)
              totalErrors++
            } else {
              totalLinked += updated?.length || 0
            }
          }

          const notFoundCount = transactionIds.length - totalLinked
          transactionLinkStats.linked += totalLinked
          transactionLinkStats.notFound += notFoundCount

          if (totalLinked > 0 || notFoundCount > 0 || totalErrors > 0) {
            console.log(`  Invoice ${invoice.invoice_id} (${invoice.invoice_type}): ${totalLinked} linked, ${notFoundCount} not in DB${totalErrors > 0 ? `, ${totalErrors} batch errors` : ''}`)
          }
        } catch (err: unknown) {
          // Log detailed error info for debugging
          const error = err as { status?: number; response?: unknown; message?: string }
          console.error(`  Error fetching transactions for invoice ${invoice.invoice_id} (${invoice.invoice_type}):`, {
            status: error.status,
            message: error.message,
            response: JSON.stringify(error.response)
          })
        }
      }

      console.log(`Transaction linking complete: ${transactionLinkStats.linked} linked, ${transactionLinkStats.notFound} not found in DB`)

    } catch (err) {
      console.error('Error fetching invoices from ShipBob:', err)
      // Continue with preflight even if invoice sync fails
    }

    // Step 2: Fetch shipping breakdown data from SFTP (if available)
    console.log('Fetching shipping breakdown from SFTP...')
    const sftpResult = await fetchShippingBreakdown(invoiceDate)

    let breakdownStats = { fetched: 0, updated: 0, notFound: 0, errors: 0 }

    if (sftpResult.success && sftpResult.rows.length > 0) {
      console.log(`Found ${sftpResult.rows.length} breakdown rows in ${sftpResult.filename}`)

      const updateResult = await updateTransactionsWithBreakdown(adminClient, sftpResult.rows)
      breakdownStats = {
        fetched: sftpResult.rows.length,
        updated: updateResult.updated,
        notFound: updateResult.notFound,
        errors: updateResult.errors.length
      }

      console.log(`Updated ${updateResult.updated} transactions with breakdown data`)
      if (updateResult.notFound > 0) {
        console.log(`  ${updateResult.notFound} shipments not found in transactions`)
      }
      if (updateResult.errors.length > 0) {
        console.log(`  ${updateResult.errors.length} errors:`, updateResult.errors.slice(0, 3))
      }
    } else if (!sftpResult.success) {
      console.log(`SFTP fetch failed: ${sftpResult.error}`)
      console.log('Continuing with preflight (breakdown data may be incomplete)')
    } else {
      console.log('No breakdown data in SFTP file')
    }

    // Step 3: Get all active clients with billing info (exclude internal/system entries)
    const { data: clients, error: clientsError } = await adminClient
      .from('clients')
      .select('id, company_name, short_code, merchant_id')
      .eq('is_active', true)
      .or('is_internal.is.null,is_internal.eq.false')

    if (clientsError || !clients) {
      console.error('Error fetching clients:', clientsError)
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    // Step 4: Get ALL unprocessed ShipBob invoices (PARENT TOKEN level - shared across clients)
    // Source of truth: invoices_sb.jetpack_invoice_id IS NULL
    // Exclude Payment type (not billable)
    const { data: unprocessedInvoices, error: invoicesError } = await adminClient
      .from('invoices_sb')
      .select('id, shipbob_invoice_id, invoice_type, base_amount, invoice_date')
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
        message: 'No unprocessed ShipBob invoices',
        invoiceSync: invoiceSyncStats,
        transactionLinking: transactionLinkStats,
        shippingBreakdown: breakdownStats,
        shipbobInvoices: [],
        preflightResults: [],
        readyForGeneration: false,
      })
    }

    // Extract ShipBob invoice IDs
    const shipbobInvoiceIds = unprocessedInvoices
      .map((inv: { shipbob_invoice_id: string }) => parseInt(inv.shipbob_invoice_id, 10))
      .filter((id: number): id is number => !isNaN(id))

    console.log(`Found ${unprocessedInvoices.length} unprocessed ShipBob invoices`)
    console.log(`  Invoice IDs: ${shipbobInvoiceIds.join(', ')}`)
    console.log(`  Types: ${[...new Set(unprocessedInvoices.map((i: { invoice_type: string }) => i.invoice_type))].join(', ')}`)

    // Step 5: Run preflight validation for each client
    const preflightResults: Array<{
      client: string
      clientId: string
      hasTransactions: boolean
      validation: ValidationResult | null
      passed: boolean
      issues: number
      warnings: number
    }> = []

    for (const client of clients) {
      if (!client.short_code) {
        preflightResults.push({
          client: client.company_name,
          clientId: client.id,
          hasTransactions: false,
          validation: null,
          passed: false,
          issues: 1,
          warnings: 0,
        })
        continue
      }

      try {
        // Check if client has transactions in these invoices
        const { count } = await adminClient
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .in('invoice_id_sb', shipbobInvoiceIds)
          .is('invoice_id_jp', null)

        if (!count || count === 0) {
          // No transactions for this client in this period
          continue
        }

        console.log(`Running preflight for ${client.company_name} (${count} transactions)...`)

        const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds)

        console.log(formatValidationResult(validation))

        preflightResults.push({
          client: client.company_name,
          clientId: client.id,
          hasTransactions: true,
          validation,
          passed: validation.passed,
          issues: validation.issues.length,
          warnings: validation.warnings.length,
        })
      } catch (err) {
        console.error(`Error running preflight for ${client.company_name}:`, err)
        preflightResults.push({
          client: client.company_name,
          clientId: client.id,
          hasTransactions: false,
          validation: null,
          passed: false,
          issues: 1,
          warnings: 0,
        })
      }
    }

    // Summary
    const clientsWithData = preflightResults.filter(r => r.hasTransactions)
    const clientsPassed = clientsWithData.filter(r => r.passed)
    const clientsFailed = clientsWithData.filter(r => !r.passed)
    const readyForGeneration = clientsFailed.length === 0 && clientsPassed.length > 0

    console.log('\n========================================')
    console.log('SYNC COMPLETE - PREFLIGHT RESULTS')
    console.log('========================================')
    console.log(`ShipBob Invoices: ${unprocessedInvoices.length}`)
    console.log(`Clients with transactions: ${clientsWithData.length}`)
    console.log(`  Passed: ${clientsPassed.length}`)
    console.log(`  Failed: ${clientsFailed.length}`)
    console.log(`Ready for generation: ${readyForGeneration ? 'YES' : 'NO'}`)
    console.log('========================================')
    console.log('Next step: Admin reviews in UI, then manually generates invoices')
    console.log('========================================\n')

    return NextResponse.json({
      success: true,
      message: 'Sync complete - ready for admin review',
      invoiceSync: invoiceSyncStats,
      transactionLinking: transactionLinkStats,
      shippingBreakdown: breakdownStats,
      shipbobInvoices: unprocessedInvoices.map((inv: { shipbob_invoice_id: string; invoice_type: string; base_amount: number; invoice_date: string }) => ({
        id: inv.shipbob_invoice_id,
        type: inv.invoice_type,
        amount: inv.base_amount,
        date: inv.invoice_date,
      })),
      preflightResults: preflightResults.filter(r => r.hasTransactions).map(r => ({
        client: r.client,
        clientId: r.clientId,
        passed: r.passed,
        issues: r.issues,
        warnings: r.warnings,
        summary: r.validation?.summary || null,
      })),
      summary: {
        totalShipbobInvoices: unprocessedInvoices.length,
        clientsWithTransactions: clientsWithData.length,
        clientsPassed: clientsPassed.length,
        clientsFailed: clientsFailed.length,
      },
      readyForGeneration,
    })
  } catch (error) {
    console.error('Error in invoice sync:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
