import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AssignCommissionRequest } from '@/lib/commissions/types'

/**
 * GET /api/admin/user-commissions
 *
 * List all user commission assignments with details.
 * Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Optional filter by user_id
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get('userId')

    let query = adminClient
      .from('user_commissions')
      .select(`
        *,
        commission_type:commission_types(*),
        clients:user_commission_clients(
          id,
          client_id,
          client:clients(id, company_name, merchant_id, eshipper_id, gofo_id)
        )
      `)
      .order('created_at', { ascending: false })

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching user commissions:', error)
      return NextResponse.json({ error: 'Failed to fetch user commissions' }, { status: 500 })
    }

    // Fetch user emails for display (from auth.users via admin API)
    // Note: This requires additional setup - for now we'll include user_id only
    // The frontend can resolve user info separately if needed

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in user-commissions GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/user-commissions
 *
 * Assign a commission to a user with client list.
 * Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: AssignCommissionRequest = await request.json()

    // Validate required fields
    if (!body.user_id || !body.commission_type_id || !body.start_date) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id, commission_type_id, start_date' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    // Check if user already has an active commission of this type
    const { data: existing } = await adminClient
      .from('user_commissions')
      .select('id')
      .eq('user_id', body.user_id)
      .eq('is_active', true)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'User already has an active commission. Deactivate it first.' },
        { status: 400 }
      )
    }

    // Create user commission
    const { data: userCommission, error: ucError } = await adminClient
      .from('user_commissions')
      .insert({
        user_id: body.user_id,
        commission_type_id: body.commission_type_id,
        start_date: body.start_date,
        is_active: true,
      })
      .select()
      .single()

    if (ucError) {
      console.error('Error creating user commission:', ucError)
      return NextResponse.json({ error: 'Failed to create user commission' }, { status: 500 })
    }

    // Add client assignments
    if (body.client_ids && body.client_ids.length > 0) {
      const clientInserts = body.client_ids.map(clientId => ({
        user_commission_id: userCommission.id,
        client_id: clientId,
      }))

      const { error: clientsError } = await adminClient
        .from('user_commission_clients')
        .insert(clientInserts)

      if (clientsError) {
        console.error('Error assigning clients:', clientsError)
        // Don't fail the whole operation, but note the error
      }
    }

    // Fetch the complete record with joins
    const { data: complete, error: fetchError } = await adminClient
      .from('user_commissions')
      .select(`
        *,
        commission_type:commission_types(*),
        clients:user_commission_clients(
          id,
          client_id,
          client:clients(id, company_name)
        )
      `)
      .eq('id', userCommission.id)
      .single()

    if (fetchError) {
      return NextResponse.json({ success: true, data: userCommission })
    }

    return NextResponse.json({ success: true, data: complete })
  } catch (error) {
    console.error('Error in user-commissions POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/user-commissions
 *
 * Update a user commission assignment.
 * Body: { id, end_date?, is_active?, client_ids? }
 * Admin only.
 */
export async function PATCH(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    if (!body.id) {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Update user commission fields
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (body.end_date !== undefined) updates.end_date = body.end_date
    if (body.is_active !== undefined) updates.is_active = body.is_active

    const { error: updateError } = await adminClient
      .from('user_commissions')
      .update(updates)
      .eq('id', body.id)

    if (updateError) {
      console.error('Error updating user commission:', updateError)
      return NextResponse.json({ error: 'Failed to update user commission' }, { status: 500 })
    }

    // Update client assignments if provided (full replacement)
    if (body.client_ids !== undefined) {
      // Delete existing assignments
      await adminClient
        .from('user_commission_clients')
        .delete()
        .eq('user_commission_id', body.id)

      // Insert new assignments
      if (body.client_ids.length > 0) {
        const clientInserts = body.client_ids.map((clientId: string) => ({
          user_commission_id: body.id,
          client_id: clientId,
        }))

        const { error: clientsError } = await adminClient
          .from('user_commission_clients')
          .insert(clientInserts)

        if (clientsError) {
          console.error('Error updating client assignments:', clientsError)
        }
      }
    }

    // Fetch updated record
    const { data: complete, error: fetchError } = await adminClient
      .from('user_commissions')
      .select(`
        *,
        commission_type:commission_types(*),
        clients:user_commission_clients(
          id,
          client_id,
          client:clients(id, company_name)
        )
      `)
      .eq('id', body.id)
      .single()

    if (fetchError) {
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: true, data: complete })
  } catch (error) {
    console.error('Error in user-commissions PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/user-commissions
 *
 * Delete a user commission assignment.
 * Query param: id
 * Admin only.
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing required query param: id' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Delete (cascade will remove client assignments)
    const { error } = await adminClient
      .from('user_commissions')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting user commission:', error)
      return NextResponse.json({ error: 'Failed to delete user commission' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in user-commissions DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
