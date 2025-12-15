import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

/**
 * GET /api/data/billing/receiving/filter-options
 *
 * Returns distinct statuses from receiving_orders table
 * for the given client. Used to populate filter dropdown dynamically.
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const clientIdParam = searchParams.get('clientId')
  const clientId = clientIdParam === 'all' ? null : (clientIdParam || DEFAULT_CLIENT_ID)

  try {
    // Fetch distinct statuses from receiving_orders
    let query = supabase
      .from('receiving_orders')
      .select('status')

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
