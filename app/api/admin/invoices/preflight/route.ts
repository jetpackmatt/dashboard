import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  runPreflightValidation,
  checkUnattributedTransactions,
  getUnattributedTransactions,
  type ValidationResult,
  type ValidationIssue,
  type UnattributedTransaction,
} from '@/lib/billing/preflight-validation'

interface ClientValidation {
  clientId: string
  clientName: string
  validation: ValidationResult
}

/**
 * GET /api/admin/invoices/preflight
 *
 * Run pre-flight validation for all clients with pending invoices.
 * Returns validation results showing data quality issues.
 */
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get all active clients (exclude internal)
    const { data: clients, error: clientsError } = await adminClient
      .from('clients')
      .select('id, company_name, short_code')
      .eq('is_active', true)
      .or('is_internal.is.null,is_internal.eq.false')

    if (clientsError || !clients) {
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    // Get unprocessed ShipBob invoices with period dates
    const { data: unprocessedInvoices, error: invoicesError } = await adminClient
      .from('invoices_sb')
      .select('id, shipbob_invoice_id, period_start, period_end')
      .is('jetpack_invoice_id', null)
      .neq('invoice_type', 'Payment')

    if (invoicesError) {
      return NextResponse.json({ error: 'Failed to fetch ShipBob invoices' }, { status: 500 })
    }

    if (!unprocessedInvoices || unprocessedInvoices.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No unprocessed ShipBob invoices',
        clients: [],
        summary: {
          totalClients: 0,
          passed: 0,
          warnings: 0,
          failed: 0,
        },
      })
    }

    const shipbobInvoiceIds = unprocessedInvoices
      .map((inv: { shipbob_invoice_id: string }) => parseInt(inv.shipbob_invoice_id, 10))
      .filter((id: number) => !isNaN(id))

    // Extract the billing period from invoices (all should have same period)
    const periodStart = unprocessedInvoices[0]?.period_start?.split('T')[0] || null
    const periodEnd = unprocessedInvoices[0]?.period_end?.split('T')[0] || null

    // Run validation for each client
    const results: ClientValidation[] = []
    let passedCount = 0
    let warningsCount = 0
    let failedCount = 0

    for (const client of clients) {
      const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds, periodStart, periodEnd)

      results.push({
        clientId: client.id,
        clientName: client.company_name,
        validation,
      })

      if (!validation.passed) {
        failedCount++
      } else if (validation.warnings.length > 0) {
        warningsCount++
      } else {
        passedCount++
      }
    }

    // Filter to only clients with transactions
    const clientsWithTransactions = results.filter(
      r => r.validation.summary.shippingTransactions > 0 ||
           r.validation.summary.additionalServiceTransactions > 0 ||
           r.validation.summary.storageTransactions > 0 ||
           r.validation.summary.returnsTransactions > 0 ||
           r.validation.summary.receivingTransactions > 0 ||
           r.validation.summary.creditsTransactions > 0
    )

    // Run GLOBAL unattributed transaction check (once, not per-client)
    const globalIssues: ValidationIssue[] = []
    const unattributedIssue = await checkUnattributedTransactions(adminClient, shipbobInvoiceIds)
    if (unattributedIssue) {
      globalIssues.push(unattributedIssue)
    }

    // Get full details of unattributed transactions for display
    const unattributedTransactions = await getUnattributedTransactions(adminClient, shipbobInvoiceIds)

    return NextResponse.json({
      success: true,
      shipbobInvoiceCount: shipbobInvoiceIds.length,
      globalIssues, // Global data quality issues (not per-client)
      unattributedTransactions, // Full details of unattributed transactions for display
      clients: clientsWithTransactions.map(r => ({
        clientId: r.clientId,
        clientName: r.clientName,
        passed: r.validation.passed,
        issues: r.validation.issues,
        warnings: r.validation.warnings,
        summary: r.validation.summary,
      })),
      summary: {
        totalClients: clientsWithTransactions.length,
        passed: clientsWithTransactions.filter(r => r.validation.passed && r.validation.warnings.length === 0).length,
        warnings: clientsWithTransactions.filter(r => r.validation.passed && r.validation.warnings.length > 0).length,
        failed: clientsWithTransactions.filter(r => !r.validation.passed).length,
        hasGlobalIssues: globalIssues.length > 0,
      },
    })
  } catch (error) {
    console.error('Error in preflight validation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
