import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/billing/returns/filter-options
 *
 * Returns distinct return statuses and return types from returns table
 * for the given client. Used to populate filter dropdowns dynamically.
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
    // Fetch distinct statuses and types from returns
    // Limit to 1000 rows - sufficient to capture all unique values for low-cardinality columns
    let query = supabase
      .from('returns')
      .select('status, return_type')
      .limit(1000)

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching returns filter options:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Extract unique statuses and types
    const statusesSet = new Set<string>()
    const typesSet = new Set<string>()

    for (const row of data || []) {
      const status = row.status as string
      const type = row.return_type as string
      if (status) {
        statusesSet.add(status)
      }
      if (type) {
        typesSet.add(type)
      }
    }

    // Sort alphabetically
    const statuses = [...statusesSet].sort((a, b) => a.localeCompare(b))
    const types = [...typesSet].sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      statuses,
      types,
    })
  } catch (err) {
    console.error('Returns Filter Options API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
