import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { calculateEligibility, ShipmentData } from '@/lib/claims/eligibility'

/**
 * GET /api/data/shipments/[id]/claim-eligibility
 *
 * Returns claim eligibility for a specific shipment.
 * Checks all 4 claim types: Lost in Transit, Damage, Incorrect Items, Incorrect Quantity
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
    // First, fetch just the client_id to verify access
    const { data: shipmentCheck, error: checkError } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', id)
      .single()

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
      }
      console.error('Error checking shipment:', checkError)
      return NextResponse.json({ error: checkError.message }, { status: 500 })
    }

    // CRITICAL SECURITY: Verify user has access to this shipment's client
    try {
      await verifyClientAccess(shipmentCheck.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Fetch shipment data needed for eligibility calculation
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select(`
        shipment_id,
        origin_country,
        destination_country,
        event_delivered,
        event_intransit,
        event_outfordelivery,
        event_logs,
        event_labeled
      `)
      .eq('shipment_id', id)
      .single()

    if (shipmentError) {
      if (shipmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
      }
      console.error('Error fetching shipment:', shipmentError)
      return NextResponse.json({ error: shipmentError.message }, { status: 500 })
    }

    // Check for existing claim tickets on this shipment
    // Claim issue types that block further claims (Incorrect Delivery is NOT a claim for this purpose)
    const claimIssueTypes = ['Loss', 'Damage', 'Pick Error', 'Short Ship', 'Incorrect Items', 'Claim']
    const { data: existingClaims } = await supabase
      .from('care_tickets')
      .select('id, ticket_number, issue_type, status')
      .eq('shipment_id', id)
      .eq('ticket_type', 'Claim')
      .in('issue_type', claimIssueTypes)
      .limit(1)

    const existingClaim = existingClaims && existingClaims.length > 0
      ? { ticketNumber: existingClaims[0].ticket_number, issueType: existingClaims[0].issue_type, status: existingClaims[0].status }
      : null

    // Calculate eligibility
    const eligibilityResult = calculateEligibility(shipment as ShipmentData)

    return NextResponse.json({ ...eligibilityResult, existingClaim })
  } catch (err) {
    console.error('Claim eligibility API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
