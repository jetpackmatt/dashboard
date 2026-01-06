import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/admin/disputes/match - Match a credit to one or more disputed charges
// Supports both single charge (charge_transaction_id) and bulk (charge_transaction_ids array)
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { charge_transaction_id, charge_transaction_ids, credit_transaction_id } = body

    // Support both single ID and array of IDs
    const chargeIds: string[] = charge_transaction_ids || (charge_transaction_id ? [charge_transaction_id] : [])

    // Validate
    if (chargeIds.length === 0 || !credit_transaction_id) {
      return NextResponse.json(
        { error: 'credit_transaction_id and at least one charge_transaction_id are required' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    // Verify credit transaction exists
    const { data: credit } = await adminClient
      .from('transactions')
      .select('transaction_id, cost, matched_credit_id')
      .eq('transaction_id', credit_transaction_id)
      .single()

    if (!credit) {
      return NextResponse.json({ error: 'Credit transaction not found' }, { status: 404 })
    }

    // Verify credit is negative (it's actually a credit)
    if (credit.cost >= 0) {
      return NextResponse.json(
        { error: 'Credit transaction must have negative cost' },
        { status: 400 }
      )
    }

    // Verify credit isn't already matched (only check if it has matched_credit_id pointing elsewhere)
    // Note: After matching, the credit will have matched_credit_id set to itself or first charge
    if (credit.matched_credit_id && !chargeIds.includes(credit.matched_credit_id)) {
      return NextResponse.json(
        { error: 'Credit is already matched to another transaction' },
        { status: 400 }
      )
    }

    // Verify all charge transactions exist
    const { data: charges, error: chargesError } = await adminClient
      .from('transactions')
      .select('transaction_id, cost, dispute_status')
      .in('transaction_id', chargeIds)

    if (chargesError) {
      console.error('Error fetching charges:', chargesError)
      return NextResponse.json({ error: 'Failed to fetch charge transactions' }, { status: 500 })
    }

    if (!charges || charges.length !== chargeIds.length) {
      const foundIds = new Set(charges?.map((c: { transaction_id: string }) => c.transaction_id) || [])
      const missingIds = chargeIds.filter(id => !foundIds.has(id))
      return NextResponse.json(
        { error: `Some charge transactions not found: ${missingIds.join(', ')}` },
        { status: 404 }
      )
    }

    // Calculate totals
    const totalCharges = charges.reduce((sum: number, c: { cost: number | null }) => sum + (c.cost || 0), 0)
    const creditAmount = credit.cost // negative value
    const netAmount = totalCharges + creditAmount

    // Update all charge transactions - link them all to this credit
    const { error: chargeError } = await adminClient
      .from('transactions')
      .update({
        dispute_status: 'credited',
        matched_credit_id: credit_transaction_id,
      })
      .in('transaction_id', chargeIds)

    if (chargeError) {
      console.error('Error updating charges:', chargeError)
      return NextResponse.json({ error: 'Failed to update charge transactions' }, { status: 500 })
    }

    // Mark credit as credited - link to first charge (for reference)
    const { error: creditError } = await adminClient
      .from('transactions')
      .update({
        dispute_status: 'credited',
        matched_credit_id: chargeIds[0], // Link to first charge for reference
      })
      .eq('transaction_id', credit_transaction_id)

    if (creditError) {
      console.error('Error updating credit:', creditError)
      return NextResponse.json({ error: 'Failed to update credit transaction' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Matched ${chargeIds.length} charge(s) with credit ${credit_transaction_id}`,
      chargesMatched: chargeIds.length,
      totalCharges,
      creditAmount,
      netAmount,
    })
  } catch (error) {
    console.error('Error in disputes/match POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
