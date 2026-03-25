import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyLostInTransit, VerifyLostInTransitResult } from '@/lib/claims/verify-lost-in-transit'

// Re-export the response type for consumers that import from the route
export type VerifyLostInTransitResponse = VerifyLostInTransitResult

/**
 * POST /api/data/shipments/[id]/verify-lost-in-transit
 *
 * Verifies Lost in Transit eligibility using TrackingMore.
 * Thin wrapper around the shared verifyLostInTransit() function.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id: shipmentId } = await params

  if (!shipmentId) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    // Fetch shipment to check client access before running verification
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', shipmentId)
      .single()

    if (shipmentError) {
      if (shipmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
      }
      return NextResponse.json({ error: shipmentError.message }, { status: 500 })
    }

    // CRITICAL SECURITY: Verify user has access to this shipment's client
    try {
      await verifyClientAccess(shipment.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    const result = await verifyLostInTransit(shipmentId, supabase)

    if (result.error === 'not_found') {
      return NextResponse.json(result, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('Verify Lost in Transit API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
