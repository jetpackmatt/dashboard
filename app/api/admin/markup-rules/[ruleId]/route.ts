import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordRuleChange } from '@/lib/billing/markup-engine'

// GET /api/admin/markup-rules/[ruleId] - Get single rule with history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const { ruleId } = await params

    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Fetch rule
    const { data: rule, error: ruleError } = await adminClient
      .from('markup_rules')
      .select('*')
      .eq('id', ruleId)
      .single()

    if (ruleError || !rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Fetch history
    const { data: history } = await adminClient
      .from('markup_rule_history')
      .select('*')
      .eq('markup_rule_id', ruleId)
      .order('changed_at', { ascending: false })

    return NextResponse.json({ rule, history: history || [] })
  } catch (error) {
    console.error('Error in markup-rules GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/admin/markup-rules/[ruleId] - Update rule
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const { ruleId } = await params

    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const adminClient = createAdminClient()

    // Get current rule for history
    const { data: currentRule } = await adminClient
      .from('markup_rules')
      .select('*')
      .eq('id', ruleId)
      .single()

    if (!currentRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Update rule
    const updateData: Record<string, unknown> = {}
    const allowedFields = [
      'name', 'client_id', 'billing_category', 'fee_type', 'order_category',
      'ship_option_id', 'markup_type', 'markup_value', 'priority', 'is_additive',
      'effective_from', 'effective_to', 'description', 'conditions', 'is_active'
    ]

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    updateData.updated_at = new Date().toISOString()

    const { data: updatedRule, error } = await adminClient
      .from('markup_rules')
      .update(updateData)
      .eq('id', ruleId)
      .select()
      .single()

    if (error) {
      console.error('Error updating rule:', error)
      return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 })
    }

    // Record history
    await recordRuleChange(
      ruleId,
      'updated',
      currentRule,
      updatedRule,
      user.id,
      body.change_reason || null
    )

    return NextResponse.json({ rule: updatedRule })
  } catch (error) {
    console.error('Error in markup-rules PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/markup-rules/[ruleId] - Hard delete (use deactivate instead)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const { ruleId } = await params

    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Soft delete - just deactivate
    const { error } = await adminClient
      .from('markup_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', ruleId)

    if (error) {
      console.error('Error deleting rule:', error)
      return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in markup-rules DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
