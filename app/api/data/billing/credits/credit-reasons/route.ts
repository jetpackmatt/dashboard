import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

/**
 * GET /api/data/billing/credits/credit-reasons
 *
 * Returns distinct credit reasons that exist in the transactions table
 * for the given client. Used to populate the reason filter dropdown dynamically.
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const clientIdParam = searchParams.get('clientId')
  const clientId = clientIdParam === 'all' ? null : (clientIdParam || DEFAULT_CLIENT_ID)

  try {
    // Fetch all credit transactions and extract unique reasons from additional_details
    let query = supabase
      .from('transactions')
      .select('additional_details')
      .eq('fee_type', 'Credit')

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching credit reasons:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Extract unique credit reasons from additional_details
    const reasonsSet = new Set<string>()
    for (const row of data || []) {
      const details = row.additional_details as Record<string, unknown> || {}
      const reason = details.CreditReason as string
      if (reason) {
        reasonsSet.add(reason)
      }
    }

    // Sort alphabetically
    const creditReasons = [...reasonsSet].sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      creditReasons,
    })
  } catch (err) {
    console.error('Credit Reasons API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
