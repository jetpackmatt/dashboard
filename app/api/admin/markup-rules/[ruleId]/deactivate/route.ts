import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordRuleChange } from '@/lib/billing/markup-engine'

// POST /api/admin/markup-rules/[ruleId]/deactivate - Deactivate rule with reason
export async function POST(
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
    const { reason } = body

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

    // Deactivate rule
    const { data: updatedRule, error } = await adminClient
      .from('markup_rules')
      .update({
        is_active: false,
        effective_to: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .select()
      .single()

    if (error) {
      console.error('Error deactivating rule:', error)
      return NextResponse.json({ error: 'Failed to deactivate rule' }, { status: 500 })
    }

    // Record history with reason
    await recordRuleChange(
      ruleId,
      'deactivated',
      currentRule,
      updatedRule,
      user.id,
      reason || 'No reason provided'
    )

    return NextResponse.json({ rule: updatedRule })
  } catch (error) {
    console.error('Error in deactivate POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
