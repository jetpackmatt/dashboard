import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Additional services fee types (same list as parent route)
const ADDITIONAL_SERVICE_FEES = [
  'Per Pick Fee',
  'B2B - Each Pick Fee',
  'B2B - Label Fee',
  'B2B - Case Pick Fee',
  'B2B - Pallet Pick Fee',
  'Inventory Placement Program Fee',
  'Warehousing Fee',
  'Multi-Hub IQ Fee',
  'Kitting Fee',
  'VAS Fee',
  'Duty/Tax',
  'Insurance',
  'Signature Required',
  'Fuel Surcharge',
  'Residential Surcharge',
  'Delivery Area Surcharge',
  'Saturday Delivery',
  'Oversized Package',
  'Dimensional Weight',
]

/**
 * GET /api/data/billing/additional-services/fee-types
 *
 * Returns distinct fee types that actually exist in the transactions table
 * for the given client. Used to populate the type filter dropdown dynamically.
 */
export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  try {
    // Single query to get all distinct fee types from transactions
    // Filter by our allowed list in the query, then get unique values
    let query = supabase
      .from('transactions')
      .select('fee_type')
      .in('fee_type', ADDITIONAL_SERVICE_FEES)
      .not('fee_type', 'is', null)
      .limit(1000) // Low cardinality - 1000 rows will capture all unique fee types

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching fee types:', error)
      return NextResponse.json({ error: 'Failed to fetch fee types' }, { status: 500 })
    }

    // Extract unique fee types from results
    const feeTypeSet = new Set<string>(
      data?.map((row: { fee_type: string }) => row.fee_type).filter((v: string | null | undefined): v is string => Boolean(v)) || []
    )
    const existingFeeTypes = [...feeTypeSet]

    // Sort alphabetically
    existingFeeTypes.sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      feeTypes: existingFeeTypes,
    })
  } catch (err) {
    console.error('Fee Types API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
