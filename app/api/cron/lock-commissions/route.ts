import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateUserCommission } from '@/lib/commissions/calculator'

/**
 * GET /api/cron/lock-commissions
 *
 * Vercel Cron Job: Runs on 1st of each month at 6 AM EST (11 AM UTC)
 *
 * Locks the previous month's commissions into snapshots.
 * Once locked, the snapshot values are final and won't change.
 *
 * Cron schedule: 0 11 1 * * (1st of month at 11:00 UTC = 6am EST)
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

    console.log('Starting commission snapshot lock...')

    const adminClient = createAdminClient()

    // Calculate previous month
    const now = new Date()
    let year = now.getFullYear()
    let month = now.getMonth() // 0-indexed (Jan = 0)

    // If we're in January, previous month is December of last year
    if (month === 0) {
      year -= 1
      month = 12
    }

    console.log(`Locking commissions for: ${month}/${year}`)

    // Get all active user commissions
    const { data: userCommissions, error: ucError } = await adminClient
      .from('user_commissions')
      .select('id, user_id')
      .eq('is_active', true)

    if (ucError) {
      console.error('Error fetching user commissions:', ucError)
      return NextResponse.json({
        success: false,
        error: ucError.message,
      }, { status: 500 })
    }

    if (!userCommissions || userCommissions.length === 0) {
      console.log('No active user commissions found')
      return NextResponse.json({
        success: true,
        message: 'No active user commissions',
        snapshotsCreated: 0,
      })
    }

    console.log(`Found ${userCommissions.length} active user commissions`)

    let snapshotsCreated = 0
    let skipped = 0
    const errors: string[] = []

    for (const uc of userCommissions) {
      try {
        // Check if snapshot already exists for this period
        const { data: existing } = await adminClient
          .from('commission_snapshots')
          .select('id')
          .eq('user_commission_id', uc.id)
          .eq('period_year', year)
          .eq('period_month', month)
          .single()

        if (existing) {
          console.log(`  Snapshot already exists for user_commission ${uc.id}`)
          skipped++
          continue
        }

        // Calculate commission for the previous month
        const result = await calculateUserCommission(adminClient, uc.user_id, year, month)

        if (!result) {
          console.log(`  No data for user_commission ${uc.id}`)
          skipped++
          continue
        }

        // Create snapshot
        const { error: insertError } = await adminClient
          .from('commission_snapshots')
          .insert({
            user_commission_id: uc.id,
            period_year: year,
            period_month: month,
            shipment_count: result.totalShipments,
            commission_amount: result.totalCommission,
            breakdown: result.byClient,
            locked_at: new Date().toISOString(),
          })

        if (insertError) {
          errors.push(`user_commission ${uc.id}: ${insertError.message}`)
        } else {
          console.log(`  Created snapshot for user_commission ${uc.id}: ${result.totalShipments} shipments, $${result.totalCommission.toFixed(2)}`)
          snapshotsCreated++
        }
      } catch (err) {
        errors.push(`user_commission ${uc.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    console.log('Commission lock results:')
    console.log(`  Snapshots created: ${snapshotsCreated}`)
    console.log(`  Skipped: ${skipped}`)
    console.log(`  Errors: ${errors.length}`)

    return NextResponse.json({
      success: errors.length === 0,
      period: { year, month },
      snapshotsCreated,
      skipped,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    console.error('Error in commission lock:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
