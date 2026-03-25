import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/client-preferences?clientId=xxx
 *
 * Fetch client preferences (auto_file_claims, etc.)
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

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clients')
    .select('auto_file_claims')
    .eq('id', clientId)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    autoFileClaims: data.auto_file_claims ?? false,
  })
}

/**
 * PATCH /api/data/client-preferences
 *
 * Update client preferences. Body: { clientId, autoFileClaims }
 */
export async function PATCH(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const body = await request.json()
  const targetClientId = body.clientId || searchParams.get('clientId')

  let clientId: string | null
  try {
    const access = await verifyClientAccess(targetClientId)
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  if (!clientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (typeof body.autoFileClaims === 'boolean') {
    updates.auto_file_claims = body.autoFileClaims
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', clientId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
