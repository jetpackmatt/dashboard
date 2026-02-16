import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
  isCareAdminRole,
} from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/data/misfits/classify-credit
 *
 * Manually classify a pending credit's shipping portion and compute billed_amount.
 *
 * Actions:
 * - no_markup: credit_shipping_portion = 0, billed_amount = cost (item-only, no markup)
 * - markup_all: credit_shipping_portion = |cost|, apply shipping markup to entire credit
 * - set_portion: credit_shipping_portion = provided value, markup only that portion
 *
 * Admin and Care Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const access = await verifyClientAccess(null)
    if (!access.isAdmin && !isCareAdminRole(access.userRole)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  try {
    const body = await request.json()
    const { transactionId, action, shippingPortion } = body as {
      transactionId: string
      action: 'no_markup' | 'markup_all' | 'set_portion'
      shippingPortion?: number
    }

    if (!transactionId || !action) {
      return NextResponse.json({ error: 'transactionId and action are required' }, { status: 400 })
    }
    if (action === 'set_portion' && (shippingPortion == null || shippingPortion < 0)) {
      return NextResponse.json({ error: 'shippingPortion must be a non-negative number for set_portion action' }, { status: 400 })
    }

    // Fetch the credit transaction
    const { data: credit, error: fetchError } = await supabase
      .from('transactions')
      .select('id, transaction_id, client_id, cost, fee_type, care_ticket_id, reference_id')
      .eq('id', transactionId)
      .single()

    if (fetchError || !credit) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    if (credit.fee_type !== 'Credit') {
      return NextResponse.json({ error: 'Transaction is not a Credit' }, { status: 400 })
    }

    const absCost = Math.abs(Number(credit.cost) || 0)

    // Look up the client's shipping markup rule for markup_all and set_portion
    let markupDecimal = 0
    let markupRuleId: string | null = null

    if (action !== 'no_markup' && credit.client_id) {
      // Find the most specific shipping markup rule for this client
      const { data: rules } = await supabase
        .from('markup_rules')
        .select('id, markup_value, billing_category')
        .eq('client_id', credit.client_id)
        .eq('billing_category', 'shipping')
        .eq('is_active', true)
        .order('id', { ascending: false })
        .limit(10)

      // "Most conditions wins" — for now, take the first active shipping rule
      if (rules && rules.length > 0) {
        markupDecimal = (rules[0].markup_value || 0) / 100
        markupRuleId = rules[0].id
      }

      // Fallback: try original shipping transaction's markup_percentage
      if (markupDecimal === 0 && credit.reference_id) {
        const { data: origShipping } = await supabase
          .from('transactions')
          .select('markup_percentage')
          .eq('reference_id', credit.reference_id)
          .eq('fee_type', 'Shipping')
          .not('markup_percentage', 'is', null)
          .limit(1)
          .maybeSingle()

        if (origShipping?.markup_percentage) {
          markupDecimal = Number(origShipping.markup_percentage)
        }
      }
    }

    let updateData: Record<string, unknown>

    if (action === 'no_markup') {
      // Item-only credit: no shipping component, pass through at cost
      updateData = {
        credit_shipping_portion: 0,
        billed_amount: credit.cost, // negative, pass through as-is
        markup_applied: 0,
        markup_percentage: 0,
        markup_rule_id: null,
        markup_is_preview: true,
        updated_at: new Date().toISOString(),
      }
    } else if (action === 'markup_all') {
      // Entire credit is a shipping label refund — markup the full amount
      const billedAmount = -(absCost * (1 + markupDecimal))
      const markupAmount = -(absCost * markupDecimal)
      updateData = {
        credit_shipping_portion: absCost,
        billed_amount: Math.round(billedAmount * 100) / 100,
        markup_applied: Math.round(markupAmount * 100) / 100,
        markup_percentage: markupDecimal,
        markup_rule_id: markupRuleId,
        markup_is_preview: true,
        updated_at: new Date().toISOString(),
      }
    } else {
      // set_portion: specific $ amount is the shipping portion
      const portion = shippingPortion!
      if (portion > absCost) {
        return NextResponse.json({ error: 'Shipping portion cannot exceed credit amount' }, { status: 400 })
      }
      const itemPortion = absCost - portion
      const billedAmount = -(portion * (1 + markupDecimal) + itemPortion)
      const markupAmount = -(portion * markupDecimal)
      updateData = {
        credit_shipping_portion: portion,
        billed_amount: Math.round(billedAmount * 100) / 100,
        markup_applied: Math.round(markupAmount * 100) / 100,
        markup_percentage: markupDecimal,
        markup_rule_id: markupRuleId,
        markup_is_preview: true,
        updated_at: new Date().toISOString(),
      }
    }

    // Update the transaction
    const { error: updateError } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', transactionId)

    if (updateError) {
      console.error('Error updating credit classification:', updateError)
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
    }

    // If care_ticket linked, update credit_amount and advance status
    // This ensures clients see the correct marked-up amount (never raw costs)
    if (credit.care_ticket_id && updateData.billed_amount != null) {
      const correctAmount = Math.abs(Number(updateData.billed_amount))

      // Fetch ticket to check current status and get events
      const { data: ticket } = await supabase
        .from('care_tickets')
        .select('status, events')
        .eq('id', credit.care_ticket_id)
        .single()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ticketUpdate: Record<string, any> = {
        credit_amount: correctAmount,
        updated_at: new Date().toISOString(),
      }

      // Advance to "Credit Approved" if still waiting for credit
      if (ticket && ticket.status === 'Credit Requested') {
        const events = (ticket.events as Array<{ status: string; note: string; createdAt: string; createdBy: string }>) || []
        const approvedEvent = {
          note: `A credit of $${correctAmount.toFixed(2)} has been approved and will appear on your next invoice.`,
          status: 'Credit Approved',
          createdAt: new Date().toISOString(),
          createdBy: 'System',
        }
        ticketUpdate.status = 'Credit Approved'
        ticketUpdate.events = [approvedEvent, ...events]
      }

      await supabase
        .from('care_tickets')
        .update(ticketUpdate)
        .eq('id', credit.care_ticket_id)
    }

    return NextResponse.json({
      success: true,
      billedAmount: updateData.billed_amount,
      markupApplied: updateData.markup_applied,
      creditShippingPortion: updateData.credit_shipping_portion,
    })
  } catch (err) {
    console.error('Error in classify-credit route:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
