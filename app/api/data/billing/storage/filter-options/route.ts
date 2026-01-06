import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/billing/storage/filter-options
 *
 * Returns distinct FCs and Location Types from storage transactions
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
    // Fetch storage transactions to extract unique FCs and location types
    let query = supabase
      .from('transactions')
      .select('fulfillment_center, reference_id')
      .eq('reference_type', 'FC')

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching storage filter options:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Extract unique FCs and location types
    const fcsSet = new Set<string>()
    const locationTypesSet = new Set<string>()

    for (const row of data || []) {
      // FC name
      const fc = row.fulfillment_center as string
      if (fc) {
        fcsSet.add(fc)
      }

      // Location type is the third part of reference_id: {FC_ID}-{InventoryId}-{LocationType}
      const refId = row.reference_id as string || ''
      const parts = refId.split('-')
      if (parts.length >= 3) {
        const locationType = parts[2]
        if (locationType) {
          locationTypesSet.add(locationType)
        }
      }
    }

    // Sort alphabetically
    const fcs = [...fcsSet].sort((a, b) => a.localeCompare(b))
    const locationTypes = [...locationTypesSet].sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      fcs,
      locationTypes,
    })
  } catch (err) {
    console.error('Storage Filter Options API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
