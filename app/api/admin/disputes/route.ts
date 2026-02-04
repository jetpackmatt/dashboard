import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/admin/disputes - List disputed transactions
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') // null, 'disputed', 'invalid', 'credited', 'all'
    const includeUnmatched = searchParams.get('unmatched') === 'true' // Show credits awaiting matching
    const searchMode = searchParams.get('search') === 'true' // Search for transactions to dispute
    const preset = searchParams.get('preset') // Quick filter presets: unattributed, orphaned, orphan_shipments
    const feeType = searchParams.get('feeType') // Filter by fee_type
    const referenceType = searchParams.get('referenceType') // Filter by reference_type (URO, WRO, etc.)
    const referenceId = searchParams.get('referenceId') // Filter by specific reference_id

    const adminClient = createAdminClient()

    // Search mode: find transactions to potentially dispute (not yet disputed)
    if (searchMode) {
      // Handle preset filters (common invalid transaction indicators)
      if (preset === 'unattributed') {
        // Transactions with no client_id
        const { data: results, error } = await adminClient
          .from('transactions')
          .select(`
            transaction_id,
            client_id,
            reference_id,
            reference_type,
            fee_type,
            cost,
            charge_date,
            invoice_id_sb,
            additional_details,
            dispute_status,
            dispute_reason
          `)
          .is('client_id', null)
          .is('dispute_status', null)
          .order('charge_date', { ascending: false })
          .limit(100)

        if (error) {
          console.error('Error fetching unattributed:', error)
          return NextResponse.json({ error: 'Failed to fetch unattributed' }, { status: 500 })
        }

        return NextResponse.json({
          searchResults: results || [],
          disputes: [],
          unmatchedCredits: [],
        })
      }

      if (preset === 'orphaned_on_jetpack') {
        // Transactions on Jetpack client that aren't Payment/CC fees (shouldn't be there)
        const { data: jetpackClient } = await adminClient
          .from('clients')
          .select('id')
          .eq('company_name', 'Jetpack')
          .single()

        if (!jetpackClient) {
          return NextResponse.json({ searchResults: [], disputes: [], unmatchedCredits: [] })
        }

        const { data: results, error } = await adminClient
          .from('transactions')
          .select(`
            transaction_id,
            client_id,
            reference_id,
            reference_type,
            fee_type,
            cost,
            charge_date,
            invoice_id_sb,
            additional_details,
            dispute_status,
            dispute_reason,
            clients(company_name)
          `)
          .eq('client_id', jetpackClient.id)
          .not('fee_type', 'in', '("Payment","Credit Card Processing Fee")')
          .is('dispute_status', null)
          .order('charge_date', { ascending: false })
          .limit(100)

        if (error) {
          console.error('Error fetching orphaned on Jetpack:', error)
          return NextResponse.json({ error: 'Failed to fetch orphaned' }, { status: 500 })
        }

        return NextResponse.json({
          searchResults: results || [],
          disputes: [],
          unmatchedCredits: [],
        })
      }

      if (preset === 'orphan_shipments') {
        // Shipment transactions where the shipment doesn't exist in shipments table
        // This requires a raw query or post-processing
        const { data: shipmentTxs, error: txError } = await adminClient
          .from('transactions')
          .select(`
            transaction_id,
            client_id,
            reference_id,
            reference_type,
            fee_type,
            cost,
            charge_date,
            invoice_id_sb,
            additional_details,
            dispute_status,
            dispute_reason,
            clients(company_name)
          `)
          .eq('reference_type', 'Shipment')
          .is('dispute_status', null)
          .order('charge_date', { ascending: false })
          .limit(500)

        if (txError) {
          console.error('Error fetching shipment txs:', txError)
          return NextResponse.json({ error: 'Failed to fetch shipment transactions' }, { status: 500 })
        }

        // Get all shipment IDs from these transactions
        const refIds = [...new Set((shipmentTxs || []).map((t: { reference_id: string }) => t.reference_id))]

        if (refIds.length === 0) {
          return NextResponse.json({ searchResults: [], disputes: [], unmatchedCredits: [] })
        }

        // Check which shipments exist
        const { data: existingShipments } = await adminClient
          .from('shipments')
          .select('shipment_id')
          .in('shipment_id', refIds)

        const existingIds = new Set((existingShipments || []).map((s: { shipment_id: string }) => s.shipment_id))

        // Filter to orphans (transactions where shipment doesn't exist)
        const orphans = (shipmentTxs || []).filter((t: { reference_id: string }) => !existingIds.has(t.reference_id))

        return NextResponse.json({
          searchResults: orphans.slice(0, 100),
          disputes: [],
          unmatchedCredits: [],
        })
      }

      // Standard search mode
      let searchQuery = adminClient
        .from('transactions')
        .select(`
          transaction_id,
          client_id,
          reference_id,
          reference_type,
          fee_type,
          cost,
          charge_date,
          invoice_id_sb,
          additional_details,
          dispute_status,
          dispute_reason,
          clients(company_name)
        `)
        .is('dispute_status', null) // Only undisputed transactions
        .order('charge_date', { ascending: false })

      if (feeType) {
        searchQuery = searchQuery.ilike('fee_type', `%${feeType}%`)
      }
      if (referenceType) {
        searchQuery = searchQuery.eq('reference_type', referenceType)
      }
      if (referenceId) {
        searchQuery = searchQuery.ilike('reference_id', `%${referenceId}%`)
      }

      const { data: searchResults, error: searchError } = await searchQuery.limit(100)

      if (searchError) {
        console.error('Error searching transactions:', searchError)
        return NextResponse.json({ error: 'Failed to search transactions' }, { status: 500 })
      }

      return NextResponse.json({
        searchResults: searchResults || [],
        disputes: [],
        unmatchedCredits: [],
      })
    }

    // Build query for disputed transactions
    let query = adminClient
      .from('transactions')
      .select(`
        transaction_id,
        client_id,
        reference_id,
        reference_type,
        fee_type,
        cost,
        charge_date,
        invoice_id_sb,
        additional_details,
        dispute_status,
        dispute_reason,
        dispute_created_at,
        matched_credit_id,
        clients(company_name)
      `)
      .order('dispute_created_at', { ascending: false, nullsFirst: false })
      .order('charge_date', { ascending: false })

    if (status === 'all') {
      // Show all transactions with any dispute status
      query = query.not('dispute_status', 'is', null)
    } else if (status) {
      query = query.eq('dispute_status', status)
    } else {
      // Default: show disputed and invalid (not yet credited)
      query = query.in('dispute_status', ['disputed', 'invalid'])
    }

    const { data: disputes, error: disputeError } = await query.limit(500)

    if (disputeError) {
      console.error('Error fetching disputes:', disputeError)
      return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 })
    }

    // Get unmatched credits if requested (credits on Jetpack system client that aren't matched)
    let unmatchedCredits: unknown[] = []
    if (includeUnmatched) {
      // Get Jetpack system client
      const { data: jetpackClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('company_name', 'Jetpack')
        .single()

      if (jetpackClient) {
        // Get actual credits/refunds - exclude Payment transactions (those are ACH payments to ShipBob)
        // Include both Jetpack-attributed credits AND unattributed credits (client_id = null)
        const { data: credits } = await adminClient
          .from('transactions')
          .select(`
            transaction_id,
            client_id,
            reference_id,
            reference_type,
            fee_type,
            cost,
            charge_date,
            invoice_id_sb,
            additional_details,
            dispute_status,
            matched_credit_id
          `)
          .or(`client_id.eq.${jetpackClient.id},client_id.is.null`)
          .lt('cost', 0) // Credits are negative
          .neq('fee_type', 'Payment') // Exclude ACH payments to ShipBob
          .is('matched_credit_id', null) // Not yet matched
          .order('charge_date', { ascending: false })
          .limit(100)

        unmatchedCredits = credits || []
      }
    }

    return NextResponse.json({
      disputes: disputes || [],
      unmatchedCredits,
    })
  } catch (error) {
    console.error('Error in disputes GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/disputes - Mark transaction as disputed/invalid
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { transaction_id, status, reason, move_to_jetpack } = body

    // Validate
    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 })
    }
    if (!status || !['disputed', 'invalid', 'credited', null].includes(status)) {
      return NextResponse.json(
        { error: 'status must be one of: disputed, invalid, credited, null' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    // Build update
    const updateData: Record<string, unknown> = {
      dispute_status: status,
      dispute_reason: reason || null,
    }

    // If marking as disputed/invalid for first time, set created_at
    if (status === 'disputed' || status === 'invalid') {
      // Check if already has a dispute_created_at
      const { data: existing } = await adminClient
        .from('transactions')
        .select('dispute_created_at')
        .eq('transaction_id', transaction_id)
        .single()

      if (!existing?.dispute_created_at) {
        updateData.dispute_created_at = new Date().toISOString()
      }
    }

    // If clearing dispute, clear all dispute fields
    if (status === null) {
      updateData.dispute_created_at = null
      updateData.dispute_reason = null
      updateData.matched_credit_id = null
    }

    // Optionally move to Jetpack system client
    if (move_to_jetpack && (status === 'disputed' || status === 'invalid')) {
      const { data: jetpackClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('company_name', 'Jetpack')
        .single()

      if (jetpackClient) {
        updateData.client_id = jetpackClient.id
        updateData.merchant_id = null
      }
    }

    // Update transaction
    const { data: updated, error } = await adminClient
      .from('transactions')
      .update(updateData)
      .eq('transaction_id', transaction_id)
      .select()
      .single()

    if (error) {
      console.error('Error updating dispute:', error)
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
    }

    return NextResponse.json({ transaction: updated })
  } catch (error) {
    console.error('Error in disputes POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
