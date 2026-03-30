import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { checkPermission } from '@/lib/permissions'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  let access
  try {
    access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const denied = checkPermission(access, 'analytics')
  if (denied) return denied

  if (!clientId || clientId === 'all') {
    return NextResponse.json({ error: 'A specific client must be selected for analytics' }, { status: 400 })
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  try {
    // Single database call — replaces 40+ sequential queries
    const { data: result, error } = await supabase.rpc('get_analytics_shipments', {
      p_client_id: clientId,
      p_start_date: startDate,
      p_end_date: endDate,
    })

    if (error) {
      console.error('Analytics RPC error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Function returns { truncated, count, data } directly
    return NextResponse.json({
      data: result?.data || [],
      truncated: result?.truncated || false,
      count: result?.count || 0,
    })
  } catch (error) {
    console.error('Analytics shipments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
