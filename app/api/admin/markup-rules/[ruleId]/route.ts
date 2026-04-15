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
      .select('*, clients(is_demo)')
      .eq('id', ruleId)
      .single()

    if (ruleError || !rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // CRITICAL: hide demo client's markup rule from admin
    if ((rule.clients as any)?.is_demo) {
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
      .select('*, clients(is_demo)')
      .eq('id', ruleId)
      .single()

    if (!currentRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // CRITICAL: refuse to modify demo client's markup rule
    if ((currentRule.clients as any)?.is_demo) {
      return NextResponse.json({ error: 'Cannot modify demo client markup rule' }, { status: 403 })
    }

    // Build the set of changed fields from the body
    const allowedFields = [
      'name', 'client_id', 'billing_category', 'fee_type', 'order_category',
      'ship_option_id', 'origin_country', 'markup_type', 'markup_value', 'priority', 'is_additive',
      'effective_from', 'effective_to', 'description', 'conditions', 'is_active'
    ]
    const changedFields: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        changedFields[field] = body[field]
      }
    }

    // Pricing-relevant changes get versioned (close old rule, insert new one) so
    // historical transactions always have a live rule for their charge_date.
    // Cosmetic changes (name, description) and window closures (effective_to,
    // is_active=false) update in place.
    const pricingFields = [
      'markup_type', 'markup_value', 'conditions', 'fee_type', 'billing_category',
      'order_category', 'ship_option_id', 'origin_country', 'is_additive', 'priority',
      'client_id',
    ]
    const currentRuleClean = (() => {
      const { clients: _c, ...rest } = currentRule as Record<string, unknown>
      return rest
    })()
    const isPricingChange = pricingFields.some(
      f => changedFields[f] !== undefined && JSON.stringify(changedFields[f]) !== JSON.stringify(currentRuleClean[f])
    )

    if (isPricingChange) {
      // Version: close the existing rule and insert a new one with the updated values.
      const newEffectiveFrom = (changedFields.effective_from as string) || new Date().toISOString().split('T')[0]
      // Close the old rule the day before the new one takes effect.
      const closeDate = new Date(newEffectiveFrom)
      closeDate.setUTCDate(closeDate.getUTCDate() - 1)
      const closeDateStr = closeDate.toISOString().split('T')[0]

      const { error: closeError } = await adminClient
        .from('markup_rules')
        .update({ effective_to: closeDateStr, updated_at: new Date().toISOString() })
        .eq('id', ruleId)
      if (closeError) {
        console.error('Error closing old rule:', closeError)
        return NextResponse.json({ error: 'Failed to close old rule' }, { status: 500 })
      }

      // Build the new row from the merged state.
      const newRow: Record<string, unknown> = { ...currentRuleClean, ...changedFields }
      delete newRow.id
      delete newRow.created_at
      delete newRow.updated_at
      newRow.effective_from = newEffectiveFrom
      newRow.effective_to = (changedFields.effective_to as string | null | undefined) ?? null
      newRow.is_active = changedFields.is_active !== undefined ? changedFields.is_active : true

      const { data: newRule, error: insertError } = await adminClient
        .from('markup_rules')
        .insert(newRow)
        .select()
        .single()
      if (insertError) {
        console.error('Error inserting new versioned rule:', insertError)
        return NextResponse.json({ error: 'Failed to create new rule version' }, { status: 500 })
      }

      await recordRuleChange(ruleId, 'updated', currentRuleClean, { ...currentRuleClean, effective_to: closeDateStr }, user.id, body.change_reason || 'Superseded by new version')
      await recordRuleChange(newRule.id, 'created', null, newRule, user.id, body.change_reason || `Supersedes rule ${ruleId}`)

      return NextResponse.json({ rule: newRule, versioned: true, supersededRuleId: ruleId })
    }

    // Non-pricing change: update in place.
    changedFields.updated_at = new Date().toISOString()

    const { data: updatedRule, error } = await adminClient
      .from('markup_rules')
      .update(changedFields)
      .eq('id', ruleId)
      .select()
      .single()

    if (error) {
      console.error('Error updating rule:', error)
      return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 })
    }

    await recordRuleChange(ruleId, 'updated', currentRuleClean, updatedRule, user.id, body.change_reason || null)

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
