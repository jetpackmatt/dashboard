import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getClient, hasClientToken, updateClient, deleteClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/clients/[clientId]
 * Returns a single client with token status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const client = await getClient(clientId)

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const has_token = await hasClientToken(clientId)

    return NextResponse.json({
      ...client,
      has_token,
    })
  } catch (error) {
    console.error('Error fetching client:', error)
    return NextResponse.json(
      { error: 'Failed to fetch client' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/clients/[clientId]
 * Update a client's details
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { company_name, merchant_id, short_code, billing_address } = body

    // Validate short_code format if provided
    const trimmedShortCode = short_code !== undefined
      ? (short_code?.trim().toUpperCase() || null)
      : undefined
    if (trimmedShortCode && !/^[A-Z]{2,3}$/.test(trimmedShortCode)) {
      return NextResponse.json(
        { error: 'Short code must be 2-3 uppercase letters' },
        { status: 400 }
      )
    }

    const client = await updateClient(clientId, {
      company_name: company_name?.trim(),
      merchant_id: merchant_id?.trim() || null,
      short_code: trimmedShortCode,
      billing_address: billing_address || null,
    })

    return NextResponse.json({ client })
  } catch (error) {
    console.error('Error updating client:', error)
    return NextResponse.json(
      { error: 'Failed to update client' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/clients/[clientId]
 * Soft delete a client (sets is_active = false)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await deleteClient(clientId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting client:', error)
    return NextResponse.json(
      { error: 'Failed to delete client' },
      { status: 500 }
    )
  }
}
