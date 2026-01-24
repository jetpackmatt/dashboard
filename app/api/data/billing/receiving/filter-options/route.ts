import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/billing/receiving/filter-options
 *
 * Returns distinct statuses from receiving_orders table
 * for the given client. Used to populate filter dropdown dynamically.
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
    // Fetch distinct statuses from receiving_orders
    // Limit to 1000 rows - sufficient to capture all unique values for low-cardinality columns
    let query = supabase
      .from('receiving_orders')
      .select('status')
      .limit(1000)

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching receiving filter options:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Extract unique statuses
    const statusesSet = new Set<string>()
    for (const row of data || []) {
      const status = row.status as string
      if (status) {
        statusesSet.add(status)
      }
    }

    // Sort alphabetically
    const statuses = [...statusesSet].sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      statuses,
    })
  } catch (err) {
    console.error('Receiving Filter Options API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
