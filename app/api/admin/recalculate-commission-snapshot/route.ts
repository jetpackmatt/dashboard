import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { calculateUserCommission } from '@/lib/commissions/calculator'

/**
 * POST /api/admin/recalculate-commission-snapshot
 *
 * Force-recalculates and updates the commission snapshot for a given month.
 * Used when new eShipper data is uploaded after a month has already been locked.
 *
 * Body: { year: number, month: number }
 */
export async function POST(request: NextRequest) {
  let access
  try {
    access = await verifyClientAccess(null)
  } catch (error) {
    return handleAccessError(error)
  }

  if (!access.isAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json()
  const { year, month } = body

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Get all active user commissions
  const { data: userCommissions, error: ucError } = await adminClient
    .from('user_commissions')
    .select('id, user_id')
    .eq('is_active', true)

  if (ucError) {
    return NextResponse.json({ error: ucError.message }, { status: 500 })
  }

  if (!userCommissions || userCommissions.length === 0) {
    return NextResponse.json({ success: true, updated: 0, message: 'No active user commissions' })
  }

  let updated = 0
  const errors: string[] = []

  for (const uc of userCommissions) {
    try {
      const result = await calculateUserCommission(adminClient, uc.user_id, year, month)

      if (!result) continue

      const { error: upsertError } = await adminClient
        .from('commission_snapshots')
        .upsert(
          {
            user_commission_id: uc.id,
            period_year: year,
            period_month: month,
            shipment_count: result.totalShipments,
            commission_amount: result.totalCommission,
            breakdown: result.byClient,
            locked_at: new Date().toISOString(),
          },
          { onConflict: 'user_commission_id,period_year,period_month' }
        )

      if (upsertError) {
        errors.push(`user_commission ${uc.id}: ${upsertError.message}`)
      } else {
        updated++
      }
    } catch (err) {
      errors.push(`user_commission ${uc.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    updated,
    errors: errors.slice(0, 10),
  })
}
