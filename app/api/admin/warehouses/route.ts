/**
 * Admin API for Fulfillment Centers (Warehouses)
 * GET - List all fulfillment centers
 * PUT - Update a fulfillment center (country, tax_rate, tax_type only - sync won't overwrite these)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  // Verify admin access
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('fulfillment_centers')
    .select('*')
    .order('country', { ascending: false })
    .order('name')

  if (error) {
    console.error('[Warehouses API] Error fetching FCs:', error)
    return NextResponse.json({ error: 'Failed to fetch fulfillment centers' }, { status: 500 })
  }

  return NextResponse.json({ fulfillmentCenters: data || [] })
}

export async function PUT(request: NextRequest) {
  // Verify admin access
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const body = await request.json()

  const { id, country, tax_rate, tax_type } = body

  if (!id) {
    return NextResponse.json({ error: 'Missing fulfillment center ID' }, { status: 400 })
  }

  // Only allow updating these specific fields (not name, which should come from sync)
  const updates: Record<string, unknown> = {
    auto_detected: false, // Mark as manually edited
    updated_at: new Date().toISOString(),
  }

  if (country !== undefined) {
    if (country !== 'US' && country !== 'CA') {
      return NextResponse.json({ error: 'Country must be US or CA' }, { status: 400 })
    }
    updates.country = country
  }

  if (tax_rate !== undefined) {
    updates.tax_rate = tax_rate === '' || tax_rate === null ? null : Number(tax_rate)
  }

  if (tax_type !== undefined) {
    updates.tax_type = tax_type === '' ? null : tax_type
  }

  const { data, error } = await supabase
    .from('fulfillment_centers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[Warehouses API] Error updating FC:', error)
    return NextResponse.json({ error: 'Failed to update fulfillment center' }, { status: 500 })
  }

  console.log(`[Warehouses API] Updated FC ${id}: ${JSON.stringify(updates)}`)

  return NextResponse.json({ fulfillmentCenter: data })
}
