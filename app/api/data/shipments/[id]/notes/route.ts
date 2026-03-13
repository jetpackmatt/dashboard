import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
} from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/shipments/[id]/notes
 * Fetch notes for a shipment.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    // Fetch shipment to verify client access
    const { data: shipment, error: checkError } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', id)
      .single()

    if (checkError || !shipment) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    try {
      await verifyClientAccess(shipment.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    const { data: notes, error: notesError } = await supabase
      .from('shipment_notes')
      .select('id, shipment_id, user_name, user_avatar_url, user_email, note, created_at')
      .eq('shipment_id', id)
      .order('created_at', { ascending: false })

    if (notesError) {
      console.error('Error fetching notes:', notesError)
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
    }

    return NextResponse.json({
      data: (notes || []).map((n: { id: string; user_name: string | null; user_avatar_url: string | null; user_email: string; note: string; created_at: string }) => ({
        id: n.id,
        userName: n.user_name,
        userAvatarUrl: n.user_avatar_url,
        userEmail: n.user_email,
        note: n.note,
        createdAt: n.created_at,
      })),
    })
  } catch (err) {
    console.error('Error in shipment notes GET:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/data/shipments/[id]/notes
 * Add a note to a shipment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const { note } = body

    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return NextResponse.json({ error: 'Note is required' }, { status: 400 })
    }

    if (note.trim().length > 500) {
      return NextResponse.json({ error: 'Note must be 500 characters or less' }, { status: 400 })
    }

    // Fetch shipment to get client_id
    const { data: shipment, error: checkError } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', id)
      .single()

    if (checkError || !shipment) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    try {
      await verifyClientAccess(shipment.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Get authenticated user
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { data: created, error: insertError } = await supabase
      .from('shipment_notes')
      .insert({
        shipment_id: id,
        client_id: shipment.client_id,
        user_id: user.id,
        user_email: user.email || 'unknown',
        user_name: user.user_metadata?.full_name || null,
        user_avatar_url: user.user_metadata?.avatar_url || null,
        note: note.trim(),
      })
      .select('id, user_name, user_avatar_url, user_email, note, created_at')
      .single()

    if (insertError) {
      console.error('Error inserting note:', insertError)
      return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
    }

    return NextResponse.json({
      data: {
        id: created.id,
        userName: created.user_name,
        userAvatarUrl: created.user_avatar_url,
        userEmail: created.user_email,
        note: created.note,
        createdAt: created.created_at,
      },
    })
  } catch (err) {
    console.error('Error in shipment notes POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/data/shipments/[id]/notes
 * Update an existing note. Body: { noteId, note }
 * Only the note's author can edit it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const { noteId, note } = body

    if (!noteId) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 })
    }
    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return NextResponse.json({ error: 'Note is required' }, { status: 400 })
    }
    if (note.trim().length > 500) {
      return NextResponse.json({ error: 'Note must be 500 characters or less' }, { status: 400 })
    }

    // Verify the note exists and belongs to this shipment
    const { data: existing, error: fetchError } = await supabase
      .from('shipment_notes')
      .select('id, shipment_id, user_id, client_id')
      .eq('id', noteId)
      .eq('shipment_id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    // Verify client access
    try {
      await verifyClientAccess(existing.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Verify the current user is the author
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'You can only edit your own notes' }, { status: 403 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('shipment_notes')
      .update({ note: note.trim() })
      .eq('id', noteId)
      .select('id, user_name, user_avatar_url, user_email, note, created_at')
      .single()

    if (updateError) {
      console.error('Error updating note:', updateError)
      return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
    }

    return NextResponse.json({
      data: {
        id: updated.id,
        userName: updated.user_name,
        userAvatarUrl: updated.user_avatar_url,
        userEmail: updated.user_email,
        note: updated.note,
        createdAt: updated.created_at,
      },
    })
  } catch (err) {
    console.error('Error in shipment notes PATCH:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/data/shipments/[id]/notes
 * Delete a note. Body: { noteId }
 * Only the note's author can delete it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const { noteId } = body

    if (!noteId) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 })
    }

    // Verify the note exists and belongs to this shipment
    const { data: existing, error: fetchError } = await supabase
      .from('shipment_notes')
      .select('id, shipment_id, user_id, client_id')
      .eq('id', noteId)
      .eq('shipment_id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    // Verify client access
    try {
      await verifyClientAccess(existing.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Verify the current user is the author
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: 'You can only delete your own notes' }, { status: 403 })
    }

    const { error: deleteError } = await supabase
      .from('shipment_notes')
      .delete()
      .eq('id', noteId)

    if (deleteError) {
      console.error('Error deleting note:', deleteError)
      return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error in shipment notes DELETE:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
