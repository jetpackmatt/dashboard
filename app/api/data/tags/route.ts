import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
} from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/tags — List all tag definitions for a client
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
    .from('client_tags')
    .select('id, name, created_at')
    .eq('client_id', clientId)
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching tags:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}

/**
 * POST /api/data/tags — Create a new tag definition
 * Body: { name: string }
 */
export async function POST(request: NextRequest) {
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

  try {
    const body = await request.json()
    const name = (body.name || '').trim()

    if (!name) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    }

    // Validate: one word, letters/numbers/dashes/underscores only
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json(
        { error: 'Tag must be a single word (letters, numbers, dashes, underscores)' },
        { status: 400 }
      )
    }

    if (name.length > 50) {
      return NextResponse.json({ error: 'Tag name must be 50 characters or less' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fix #6: Max 25 tag definitions per client
    const { count, error: countError } = await supabase
      .from('client_tags')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)

    if (countError) {
      console.error('Error counting tags:', countError)
      return NextResponse.json({ error: 'Failed to check tag count' }, { status: 500 })
    }

    if ((count ?? 0) >= 25) {
      return NextResponse.json({ error: 'Maximum 25 tags per brand. Delete unused tags first.' }, { status: 400 })
    }

    // Fix #7: Get current user for audit trail
    let createdBy: string | null = null
    try {
      const serverClient = await createServerClient()
      const { data: { user } } = await serverClient.auth.getUser()
      createdBy = user?.id ?? null
    } catch {
      // Non-critical — proceed without audit trail
    }

    const { data, error } = await supabase
      .from('client_tags')
      .insert({ client_id: clientId, name, created_by: createdBy })
      .select('id, name, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Tag already exists (names are case-insensitive)' }, { status: 409 })
      }
      console.error('Error creating tag:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('Error in tags POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/data/tags — Delete a tag definition and remove from all shipments
 * Body: { tagId: string }
 */
export async function DELETE(request: NextRequest) {
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

  try {
    const body = await request.json()
    const { tagId } = body

    if (!tagId) {
      return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch the tag to get its name (for removing from shipments)
    const { data: tag, error: fetchError } = await supabase
      .from('client_tags')
      .select('name')
      .eq('id', tagId)
      .eq('client_id', clientId)
      .single()

    if (fetchError || !tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    // Remove this tag from all shipments that have it — must succeed before we delete the definition
    const { error: rpcError } = await supabase.rpc('remove_tag_from_shipments', {
      p_client_id: clientId,
      p_tag_name: tag.name,
    })

    if (rpcError) {
      console.error('Error removing tag from shipments:', rpcError)
      return NextResponse.json(
        { error: 'Failed to remove tag from shipments. Tag was not deleted.' },
        { status: 500 }
      )
    }

    // Only delete the tag definition after shipments are cleaned up
    const { error: deleteError } = await supabase
      .from('client_tags')
      .delete()
      .eq('id', tagId)
      .eq('client_id', clientId)

    if (deleteError) {
      console.error('Error deleting tag:', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error in tags DELETE:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
