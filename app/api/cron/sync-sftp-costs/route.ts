import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchDailyShippingBreakdown,
  updateTransactionsWithDailyBreakdown,
} from '@/lib/billing/sftp-client'
import { calculateShipmentPreviewMarkups } from '@/lib/billing/preview-markups'

/**
 * GET /api/cron/sync-sftp-costs
 *
 * Vercel Cron Job: Runs daily at 5 AM EST (10 AM UTC)
 *
 * Syncs shipping cost breakdown data from the new daily SFTP format.
 * Updates base_cost, surcharge, surcharge_details (JSONB), and insurance_cost
 * on shipping transactions.
 *
 * IMPORTANT: SFTP files appear 1 day AFTER the transaction's charge_date.
 * This cron fetches TODAY's file, which contains YESTERDAY's transactions.
 *
 * Cron schedule: 0 10 * * * (every day at 10:00 UTC = 5am EST)
 */
export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max (backfill may process up to 4 files)

export async function GET(request: Request) {
  try {
    // Verify this is a Vercel cron request
    const authHeader = request.headers.get('authorization')

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const cronStart = Date.now()
    console.log('Starting daily SFTP cost sync...')

    const adminClient = createAdminClient()

    // Get today's date (the SFTP file date)
    // Today's file contains yesterday's charge_date transactions
    const today = new Date()
    const dateStr = formatDateForLog(today)

    console.log(`Fetching SFTP file for: ${dateStr}`)
    console.log(`(contains transactions charged on: ${formatDateForLog(yesterday(today))})`)

    // Track results across all steps
    let sftpFilename = ''
    let sftpDate = ''
    let sftpRawRows = 0
    let sftpShipments = 0
    let sftpUpdated = 0
    let sftpNotFound = 0
    let sftpErrors: string[] = []
    let sftpFetchFailed = false

    // Step 1: Fetch today's daily file
    const sftpResult = await fetchDailyShippingBreakdown(today)

    if (!sftpResult.success) {
      console.log(`SFTP fetch failed: ${sftpResult.error}`)
      sftpFetchFailed = true
      sftpFilename = sftpResult.filename || ''
      // Don't return early — still need to run backfill and preview markups
    } else {
      sftpFilename = sftpResult.filename || ''
      sftpDate = sftpResult.date || ''
      sftpRawRows = sftpResult.rawRowCount || 0

      console.log(`Fetched ${sftpFilename}:`)
      console.log(`  Raw rows: ${sftpRawRows}`)
      console.log(`  Unique shipments: ${sftpResult.rows.length}`)

      if (sftpResult.rows.length > 0) {
        sftpShipments = sftpResult.rows.length

        // Step 2: Update transactions with breakdown data
        // Pass fileDate to enable precise matching for reshipments (same shipment, different dates)
        const updateResult = await updateTransactionsWithDailyBreakdown(adminClient, sftpResult.rows, today)

        sftpUpdated = updateResult.updated
        sftpNotFound = updateResult.notFound
        sftpErrors = updateResult.errors

        console.log('Update results:')
        console.log(`  Updated: ${sftpUpdated}`)
        console.log(`  Not found: ${sftpNotFound}`)
        console.log(`  Errors: ${sftpErrors.length}`)

        if (sftpErrors.length > 0) {
          console.log('First 5 errors:')
          for (const err of sftpErrors.slice(0, 5)) {
            console.log(`    ${err}`)
          }
        }
      } else {
        console.log('No shipments in SFTP file, nothing to update')
      }
    }

    // Step 2b: Backfill pass — retry SFTP matching for previous 8 days
    // Catches transactions that arrived in DB after the original SFTP cron ran.
    // Window must cover the full Mon-Sun invoicing week so preflight on Monday
    // morning never sees missing base_cost on shipments from earlier in the week.
    // IMPORTANT: Runs even if primary SFTP fetch failed
    console.log('Starting SFTP backfill for previous 8 days...')
    const backfillResults: Array<{ date: string; missing: number; updated: number; notFound: number }> = []

    for (let daysAgo = 1; daysAgo <= 8; daysAgo++) {
      const backfillFileDate = new Date(today)
      backfillFileDate.setDate(backfillFileDate.getDate() - daysAgo)
      const backfillChargeDate = yesterday(backfillFileDate)
      const chargeDateStr = formatDateForLog(backfillChargeDate)

      // Check if there are unmatched positive-cost Shipping transactions for this charge_date
      // (negative-cost refunds are handled separately by the refund backfill in sftp-client.ts)
      const { count, error: countError } = await adminClient
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('fee_type', 'Shipping')
        .eq('reference_type', 'Shipment')
        .eq('charge_date', chargeDateStr)
        .is('base_cost', null)
        .or('is_voided.is.null,is_voided.eq.false')
        .gt('cost', 0)

      if (countError) {
        console.log(`  Backfill day -${daysAgo} (${chargeDateStr}): Error checking: ${countError.message}`)
        continue
      }

      if (!count || count === 0) {
        continue
      }

      console.log(`  Backfill day -${daysAgo} (${chargeDateStr}): ${count} unmatched, fetching SFTP file...`)

      const backfillSftp = await fetchDailyShippingBreakdown(backfillFileDate)
      if (!backfillSftp.success) {
        console.log(`  Backfill day -${daysAgo}: File not found (${backfillSftp.error})`)
        continue
      }

      const backfillUpdate = await updateTransactionsWithDailyBreakdown(
        adminClient, backfillSftp.rows, backfillFileDate
      )

      backfillResults.push({
        date: chargeDateStr,
        missing: count,
        updated: backfillUpdate.updated,
        notFound: backfillUpdate.notFound,
      })

      console.log(`  Backfill day -${daysAgo} (${chargeDateStr}): ${backfillUpdate.updated} updated, ${backfillUpdate.notFound} not found`)
    }

    if (backfillResults.length > 0) {
      console.log(`Backfill complete: ${backfillResults.reduce((s, r) => s + r.updated, 0)} total updated`)
    } else {
      console.log('Backfill: no unmatched transactions in previous 3 days')
    }

    // Step 3: Calculate preview markups for shipments that now have base_cost
    // IMPORTANT: Runs ALWAYS — even if SFTP fetch failed or had no rows.
    // There may be eligible transactions from previous days that need markup.
    const step3Start = Date.now()
    const elapsedBeforeMarkup = step3Start - cronStart
    console.log(`Calculating preview markups for shipments... (${elapsedBeforeMarkup}ms elapsed so far)`)

    // Check how many are eligible BEFORE processing (diagnostic)
    const { count: eligibleCount } = await adminClient
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('fee_type', 'Shipping')
      .not('client_id', 'is', null)
      .or('invoiced_status_jp.is.null,invoiced_status_jp.eq.false')
      .is('markup_is_preview', null)
      .not('base_cost', 'is', null)
    console.log(`Preview markup: ${eligibleCount || 0} eligible transactions found`)

    const markupResult = await calculateShipmentPreviewMarkups({ limit: 5000 })
    const step3Duration = Date.now() - step3Start
    console.log(`Preview markups: ${markupResult.updated} updated, ${markupResult.skipped} skipped (${step3Duration}ms)`)
    if (markupResult.errors.length > 0) {
      console.log(`Preview markup errors: ${markupResult.errors.slice(0, 5).join(', ')}`)
    }
    const totalDuration = Date.now() - cronStart
    console.log(`Total SFTP cron duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`)

    return NextResponse.json({
      success: !sftpFetchFailed,
      sftpFetchFailed,
      filename: sftpFilename,
      date: sftpDate,
      rawRows: sftpRawRows,
      shipments: sftpShipments,
      updated: sftpUpdated,
      notFound: sftpNotFound,
      errors: sftpErrors.length,
      errorDetails: sftpErrors.slice(0, 10),
      previewMarkups: {
        updated: markupResult.updated,
        skipped: markupResult.skipped,
        errors: markupResult.errors.length,
      },
      backfill: backfillResults,
    })

  } catch (error) {
    console.error('Error in SFTP cost sync:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// Helper: Format date as YYYY-MM-DD for logs
function formatDateForLog(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Helper: Get yesterday
function yesterday(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - 1)
  return d
}
