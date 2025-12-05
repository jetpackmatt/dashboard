import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getClientsWithTokenStatus, createNewClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/clients
 * Returns all clients with their token status (admin only)
 */
export async function GET() {
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

    const clients = await getClientsWithTokenStatus()

    return NextResponse.json({
      clients,
      count: clients.length,
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
    const { company_name, shipbob_user_id } = body

    if (!company_name || typeof company_name !== 'string') {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      )
    }

    const client = await createNewClient({
      company_name: company_name.trim(),
      shipbob_user_id: shipbob_user_id?.trim() || null,
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
