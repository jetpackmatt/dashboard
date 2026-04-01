import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  if (!clientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
  }

  const sku = searchParams.get('sku')
  if (!sku) {
    return NextResponse.json({ error: 'sku is required' }, { status: 400 })
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const country = searchParams.get('country') || 'ALL'

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('get_sku_cost_trend', {
    p_client_id: clientId,
    p_sku: sku,
    p_start: startDate,
    p_end: endDate,
    p_country: country,
  })

  if (error) {
    console.error('[sku-cost-trend] RPC error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch SKU cost trend' }, { status: 500 })
  }

  return NextResponse.json({ data })
}
