import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getClientsWithTokenStatus, createNewClient, hasAllClientsAccess, isAdminRole, isCareRole } from '@/lib/supabase/admin'

/**
 * GET /api/admin/clients
 * Returns all clients with their token status
 * Allowed: admin, care_admin, care_team
 */
export async function GET() {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check role from user metadata - allow admin and care users
    const userRole = user.user_metadata?.role
    const isAdmin = isAdminRole(userRole)
    const isCareUser = isCareRole(userRole)

    if (!hasAllClientsAccess(userRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const clients = await getClientsWithTokenStatus()

    return NextResponse.json({
      clients,
      count: clients.length,
      isAdmin,
      isCareUser,
      userRole,
    })
  } catch (error) {
    console.error('Error fetching clients:', error)
    return NextResponse.json(
      { error: 'Failed to fetch clients' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/clients
 * Create a new client (admin only)
 */
export async function POST(request: Request) {
  try {
    // Verify user is authenticated and is admin
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role from user metadata
    const isAdmin = user.user_metadata?.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { company_name, merchant_id, shipbob_token, short_code } = body

    if (!company_name || typeof company_name !== 'string') {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      )
    }

    if (!shipbob_token || typeof shipbob_token !== 'string') {
      return NextResponse.json(
        { error: 'ShipBob Token is required' },
        { status: 400 }
      )
    }

    // Validate short_code format if provided
    const trimmedShortCode = short_code?.trim().toUpperCase() || null
    if (trimmedShortCode && !/^[A-Z]{2,3}$/.test(trimmedShortCode)) {
      return NextResponse.json(
        { error: 'Short code must be 2-3 uppercase letters' },
        { status: 400 }
      )
    }

    const client = await createNewClient({
      company_name: company_name.trim(),
      merchant_id: merchant_id?.trim() || null,
      shipbob_token: shipbob_token.trim(),
      short_code: trimmedShortCode,
    })

    return NextResponse.json({ client }, { status: 201 })
  } catch (error) {
    console.error('Error creating client:', error)
    return NextResponse.json(
      { error: 'Failed to create client' },
      { status: 500 }
    )
  }
}
