import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
} from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * PATCH /api/data/shipments/[id]/tags
 * Update tags on a shipment. Body: { tags: string[] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

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

  try {
    const body = await request.json()
    const { tags } = body

    if (!Array.isArray(tags)) {
      return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 })
    }

    // Validate each tag
    for (const tag of tags) {
      if (typeof tag !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(tag)) {
        return NextResponse.json(
          { error: `Invalid tag: "${tag}". Tags must be single words (letters, numbers, dashes, underscores).` },
          { status: 400 }
        )
      }
    }

    const { error: updateError } = await supabase
      .from('shipments')
      .update({ tags })
      .eq('shipment_id', id)

    if (updateError) {
      console.error('Error updating shipment tags:', updateError)
      return NextResponse.json({ error: 'Failed to update tags' }, { status: 500 })
    }

    return NextResponse.json({ success: true, tags })
  } catch (err) {
    console.error('Error in shipment tags PATCH:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
