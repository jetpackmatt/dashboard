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
export const maxDuration = 120 // 2 minutes max

export async function GET(request: Request) {
  try {
    // Verify this is a Vercel cron request
    const authHeader = request.headers.get('authorization')

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('Starting daily SFTP cost sync...')

    const adminClient = createAdminClient()

    // Get today's date (the SFTP file date)
    // Today's file contains yesterday's charge_date transactions
    const today = new Date()
    const dateStr = formatDateForLog(today)

    console.log(`Fetching SFTP file for: ${dateStr}`)
    console.log(`(contains transactions charged on: ${formatDateForLog(yesterday(today))})`)

    // Step 1: Fetch today's daily file
    const sftpResult = await fetchDailyShippingBreakdown(today)

    if (!sftpResult.success) {
      console.log(`SFTP fetch failed: ${sftpResult.error}`)
      return NextResponse.json({
        success: false,
        filename: sftpResult.filename,
        error: sftpResult.error,
        message: 'SFTP file not found or fetch failed'
      })
    }

    console.log(`Fetched ${sftpResult.filename}:`)
    console.log(`  Raw rows: ${sftpResult.rawRowCount}`)
    console.log(`  Unique shipments: ${sftpResult.rows.length}`)

    if (sftpResult.rows.length === 0) {
      console.log('No shipments in SFTP file, nothing to update')
      return NextResponse.json({
        success: true,
        filename: sftpResult.filename,
        date: sftpResult.date,
        rawRows: sftpResult.rawRowCount,
        shipments: 0,
        updated: 0,
        notFound: 0,
        errors: 0,
        message: 'No shipments in file'
      })
    }

    // Step 2: Update transactions with breakdown data
    // Pass fileDate to enable precise matching for reshipments (same shipment, different dates)
    const updateResult = await updateTransactionsWithDailyBreakdown(adminClient, sftpResult.rows, today)

    console.log('Update results:')
    console.log(`  Updated: ${updateResult.updated}`)
    console.log(`  Not found: ${updateResult.notFound}`)
    console.log(`  Errors: ${updateResult.errors.length}`)

    if (updateResult.errors.length > 0) {
      console.log('First 5 errors:')
      for (const err of updateResult.errors.slice(0, 5)) {
        console.log(`    ${err}`)
      }
    }

    // Step 3: Calculate preview markups for shipments that now have base_cost
    // This makes marked-up charges visible immediately after SFTP sync
    console.log('Calculating preview markups for shipments...')
    const markupResult = await calculateShipmentPreviewMarkups({ limit: 5000 })
    console.log(`Preview markups: ${markupResult.updated} updated, ${markupResult.skipped} skipped`)
    if (markupResult.errors.length > 0) {
      console.log(`Preview markup errors: ${markupResult.errors.slice(0, 3).join(', ')}`)
    }

    return NextResponse.json({
      success: true,
      filename: sftpResult.filename,
      date: sftpResult.date,
      rawRows: sftpResult.rawRowCount,
      shipments: sftpResult.rows.length,
      updated: updateResult.updated,
      notFound: updateResult.notFound,
      errors: updateResult.errors.length,
      errorDetails: updateResult.errors.slice(0, 10),
      previewMarkups: {
        updated: markupResult.updated,
        skipped: markupResult.skipped,
        errors: markupResult.errors.length,
      }
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
