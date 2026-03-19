import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const rawClientId = searchParams.get('clientId')

  try {
    await verifyClientAccess(rawClientId)
  } catch (error) {
    return handleAccessError(error)
  }

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
  const { data, error } = await supabase.rpc('get_otd_percentiles', {
    p_client_id: rpcClientId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_country: country,
    p_state: state,
    p_include_delayed: includeDelayed,
  })

  if (error) {
    console.error('[otd-percentiles] RPC error:', error.message)
    return NextResponse.json({ error: 'Failed to compute percentiles' }, { status: 500 })
  }

  return NextResponse.json(data)
}
