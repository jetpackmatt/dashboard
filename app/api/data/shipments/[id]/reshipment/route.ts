import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
} from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/data/shipments/[id]/reshipment
 * Mark a shipment as reshipped with a reshipment shipment ID.
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
    const { reshipmentId } = body

    if (!reshipmentId || typeof reshipmentId !== 'string' || reshipmentId.trim().length === 0) {
      return NextResponse.json({ error: 'Reshipment ID is required' }, { status: 400 })
    }

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

    const { error: updateError } = await supabase
      .from('shipments')
      .update({
        reshipment_id: reshipmentId.trim(),
        reshipment_date: new Date().toISOString(),
      })
      .eq('shipment_id', id)

    if (updateError) {
      console.error('Error updating reshipment:', updateError)
      return NextResponse.json({ error: 'Failed to mark as reshipped' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error in reshipment POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
