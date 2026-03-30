import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { checkPermission } from '@/lib/permissions'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const rawClientId = searchParams.get('clientId')

  let access
  try {
    access = await verifyClientAccess(rawClientId)
  } catch (error) {
    return handleAccessError(error)
  }

  const denied = checkPermission(access, 'analytics.performance')
  if (denied) return denied

  const isAllClients = rawClientId === 'all'
  const rpcClientId = isAllClients ? null : rawClientId

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const country = searchParams.get('country') || 'ALL'
  const state = searchParams.get('state') || null
  const includeDelayed = searchParams.get('includeDelayed') !== 'false'

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const rpcParams = {
    p_client_id: rpcClientId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_country: country,
    p_state: state,
    p_include_delayed: includeDelayed,
  }

  // Fetch core percentiles (P20/P50/P80) and extreme percentiles (P5/P95) in parallel
  const [coreResult, extremeResult] = await Promise.all([
    supabase.rpc('get_otd_percentiles', rpcParams),
    supabase.rpc('get_otd_extreme_percentiles', rpcParams),
  ])

  if (coreResult.error) {
    console.error('[otd-percentiles] Core RPC error:', coreResult.error.message)
    return NextResponse.json({ error: 'Failed to compute percentiles' }, { status: 500 })
  }

  // Merge extreme percentiles into core result (graceful fallback if extreme RPC not yet deployed)
  const merged = {
    ...coreResult.data,
    otd_p5: extremeResult.data?.otd_p5 ?? null,
    otd_p95: extremeResult.data?.otd_p95 ?? null,
    otd_mean: extremeResult.data?.otd_mean ?? null,
  }

  if (extremeResult.error) {
    console.warn('[otd-percentiles] Extreme RPC not available yet:', extremeResult.error.message)
  }

  return NextResponse.json(merged)
}
