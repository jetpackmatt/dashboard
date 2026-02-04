import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CreateCommissionTypeRequest } from '@/lib/commissions/types'

/**
 * GET /api/admin/commission-types
 *
 * List all commission types. Admin only.
 */
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('commission_types')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      console.error('Error fetching commission types:', error)
      return NextResponse.json({ error: 'Failed to fetch commission types' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in commission-types GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/commission-types
 *
 * Create a new commission type. Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: CreateCommissionTypeRequest = await request.json()

    // Validate required fields
    if (!body.name || !body.formula_type || !body.formula_params) {
      return NextResponse.json(
        { error: 'Missing required fields: name, formula_type, formula_params' },
        { status: 400 }
      )
    }

    // Validate formula_params for power type
    if (body.formula_type === 'power') {
      if (typeof body.formula_params.C !== 'number' || typeof body.formula_params.K !== 'number') {
        return NextResponse.json(
          { error: 'formula_params must include C and K as numbers' },
          { status: 400 }
        )
      }
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('commission_types')
      .insert({
        name: body.name,
        formula_type: body.formula_type,
        formula_params: body.formula_params,
        description: body.description || null,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating commission type:', error)
      return NextResponse.json({ error: 'Failed to create commission type' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in commission-types POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/commission-types
 *
 * Update a commission type. Admin only.
 * Body: { id, name?, formula_params?, description?, is_active? }
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

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) updates.name = body.name
    if (body.formula_params !== undefined) updates.formula_params = body.formula_params
    if (body.description !== undefined) updates.description = body.description
    if (body.is_active !== undefined) updates.is_active = body.is_active

    const { data, error } = await adminClient
      .from('commission_types')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating commission type:', error)
      return NextResponse.json({ error: 'Failed to update commission type' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in commission-types PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
