import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/orphans
 *
 * Returns all unattributed transactions (client_id = NULL)
 * that need manual attribution.
 *
 * Query params:
 *   - limit: number of results (default 100)
 *   - offset: pagination offset
 *   - feeType: filter by fee type
 *   - referenceType: filter by reference type
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const feeType = searchParams.get('feeType')
    const referenceType = searchParams.get('referenceType')

    const adminClient = createAdminClient()

    // Build query for unattributed transactions
    let query = adminClient
      .from('transactions')
      .select(`
        transaction_id,
        reference_id,
        reference_type,
        fee_type,
        cost,
        charge_date,
        tracking_id,
        fulfillment_center,
        additional_details,
        invoice_id_sb,
        created_at
      `, { count: 'exact' })
      .is('client_id', null)
      .is('dispute_status', null) // Exclude already disputed
      .order('charge_date', { ascending: false })

    // Apply filters
    if (feeType) {
      query = query.eq('fee_type', feeType)
    }
    if (referenceType) {
      query = query.eq('reference_type', referenceType)
    }

    // Pagination
    query = query.range(offset, offset + limit - 1)

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('Error fetching orphaned transactions:', error)
      return NextResponse.json({ error: 'Failed to fetch orphaned transactions' }, { status: 500 })
    }

    // Get summary stats - group by fee_type and reference_type
    const { data: summaryByFeeType } = await adminClient
      .from('transactions')
      .select('fee_type')
      .is('client_id', null)
      .is('dispute_status', null)

    const { data: summaryByRefType } = await adminClient
      .from('transactions')
      .select('reference_type')
      .is('client_id', null)
      .is('dispute_status', null)

    // Count by fee_type
    const feeTypeCounts: Record<string, number> = {}
    for (const tx of summaryByFeeType || []) {
      const ft = tx.fee_type || 'Unknown'
      feeTypeCounts[ft] = (feeTypeCounts[ft] || 0) + 1
    }

    // Count by reference_type
    const refTypeCounts: Record<string, number> = {}
    for (const tx of summaryByRefType || []) {
      const rt = tx.reference_type || 'Unknown'
      refTypeCounts[rt] = (refTypeCounts[rt] || 0) + 1
    }

    // Total cost of unattributed transactions
    const { data: costData } = await adminClient
      .from('transactions')
      .select('cost')
      .is('client_id', null)
      .is('dispute_status', null)

    const totalCost = (costData || []).reduce((sum: number, tx: { cost: string | number | null }) => {
      const cost = parseFloat(String(tx.cost || 0))
      return sum + (isNaN(cost) ? 0 : cost)
    }, 0)

    return NextResponse.json({
      transactions: transactions || [],
      total: count || 0,
      summary: {
        byFeeType: feeTypeCounts,
        byReferenceType: refTypeCounts,
        totalCost,
      },
    })
  } catch (error) {
    console.error('Error in orphans API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
