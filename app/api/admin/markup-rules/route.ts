import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordRuleChange } from '@/lib/billing/markup-engine'

// GET /api/admin/markup-rules - List all markup rules
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch rules using admin client. Exclude demo client's markup rule.
    const adminClient = createAdminClient()
    const { excludeDemoClients } = await import('@/lib/demo/exclusion')
    let rulesQuery = adminClient
      .from('markup_rules')
      .select('*')
      .order('client_id', { ascending: true, nullsFirst: true })
      .order('priority', { ascending: false })
      .order('name', { ascending: true })
    await excludeDemoClients(adminClient, rulesQuery)
    const { data: rules, error } = await rulesQuery

    if (error) {
      console.error('Error fetching markup rules:', error)
      return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 })
    }

    return NextResponse.json({ rules })
  } catch (error) {
    console.error('Error in markup-rules GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/markup-rules - Create new markup rule
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      name,
      client_id,
      billing_category,
      fee_type,
      order_category,
      ship_option_id,
      origin_country,
      markup_type,
      markup_value,
      priority,
      is_additive,
      effective_from,
      effective_to,
      description,
      conditions,
    } = body

    // Validate required fields
    if (!name || !markup_type || markup_value === undefined || !effective_from) {
      return NextResponse.json(
        { error: 'Missing required fields: name, markup_type, markup_value, effective_from' },
        { status: 400 }
      )
    }

    // Create rule
    const adminClient = createAdminClient()

    // CRITICAL: refuse to create markup rules for demo clients.
    if (client_id) {
      const { data: target } = await adminClient.from('clients').select('is_demo').eq('id', client_id).maybeSingle()
      if (target?.is_demo) {
        return NextResponse.json({ error: 'Cannot create markup rules for demo clients' }, { status: 403 })
      }
    }
    const { data: rule, error } = await adminClient
      .from('markup_rules')
      .insert({
        name,
        client_id: client_id || null,
        billing_category: billing_category || null,
        fee_type: fee_type || null,
        order_category: order_category || null,
        ship_option_id: ship_option_id || null,
        origin_country: origin_country || null,
        markup_type,
        markup_value,
        priority: priority || 0,
        is_additive: is_additive ?? true,
        effective_from,
        effective_to: effective_to || null,
        description: description || null,
        conditions: conditions || {},
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating markup rule:', error)
      return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 })
    }

    // Record history
    await recordRuleChange(
      rule.id,
      'created',
      null,
      rule,
      user.id,
      'Initial creation'
    )

    return NextResponse.json({ rule })
  } catch (error) {
    console.error('Error in markup-rules POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
