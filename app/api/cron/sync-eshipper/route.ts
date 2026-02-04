import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncEshipperCounts } from '@/lib/eshipper/sync'

/**
 * GET /api/cron/sync-eshipper
 *
 * Vercel Cron Job: Runs every minute
 *
 * Syncs shipment counts from eShipper API for all clients
 * that have an eshipper_id configured.
 *
 * Cron schedule: * * * * * (every minute)
 */
export const runtime = 'nodejs'
export const maxDuration = 60 // 1 minute max

export async function GET(request: Request) {
  try {
    // Verify this is a Vercel cron request
    const authHeader = request.headers.get('authorization')

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if eShipper is configured
    if (!process.env.ESHIPPER_API_KEY) {
      console.log('eShipper API not configured, skipping sync')
      return NextResponse.json({
        success: true,
        message: 'eShipper API not configured',
        skipped: true,
      })
    }

    console.log('Starting eShipper sync...')

    const adminClient = createAdminClient()

    // Sync yesterday's data (eShipper data may lag by a day)
    const result = await syncEshipperCounts(adminClient, 1)

    console.log('eShipper sync results:')
    console.log(`  Clients processed: ${result.clientsProcessed}`)
    console.log(`  Days updated: ${result.daysUpdated}`)
    console.log(`  Errors: ${result.errors.length}`)

    if (result.errors.length > 0) {
      console.log('First 5 errors:')
      for (const err of result.errors.slice(0, 5)) {
        console.log(`    ${err}`)
      }
    }

    return NextResponse.json({
      success: result.success,
      clientsProcessed: result.clientsProcessed,
      daysUpdated: result.daysUpdated,
      errors: result.errors.slice(0, 10),
    })
  } catch (error) {
    console.error('Error in eShipper sync:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
