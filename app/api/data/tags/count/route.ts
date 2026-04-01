import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
} from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/tags/count?clientId=X&tagName=Y — Count shipments using a specific tag
 */
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

  const tagName = searchParams.get('tagName')
  if (!tagName) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { count, error } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .contains('tags', [tagName])

  if (error) {
    console.error('Error counting tag usage:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: count || 0 })
}
