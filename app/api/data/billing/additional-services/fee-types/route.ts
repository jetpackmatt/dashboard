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
    // For each fee type in our allowed list, check if any records exist
    // This is more efficient than fetching all records when there are many
    const existingFeeTypes: string[] = []

    for (const feeType of ADDITIONAL_SERVICE_FEES) {
      let query = supabase
        .from('transactions')
        .select('fee_type', { count: 'exact', head: true })
        .eq('fee_type', feeType)

      if (clientId) {
        query = query.eq('client_id', clientId)
      }

      const { count, error } = await query

      if (error) {
        console.error(`Error checking fee type ${feeType}:`, error)
        continue
      }

      if (count && count > 0) {
        existingFeeTypes.push(feeType)
      }
    }

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
