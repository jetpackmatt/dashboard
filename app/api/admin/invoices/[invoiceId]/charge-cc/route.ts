import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Stripe from 'stripe'

// Lazy-initialize Stripe client
let stripeClient: Stripe | null = null
function getStripe(): Stripe {
  if (!stripeClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not configured')
    }
    stripeClient = new Stripe(secretKey)
  }
  return stripeClient
}

/**
 * POST /api/admin/invoices/[invoiceId]/charge-cc
 *
 * Manually charge a client's credit card for an invoice.
 * If the invoice doesn't already have a CC fee, adds 3% to the charge amount.
 *
 * This allows admins to charge outstanding invoices for clients who switch to CC payment.
 *
 * Prerequisites:
 * - Client must have stripe_customer_id and stripe_payment_method_id
 * - Invoice must be in 'approved' or 'sent' status
 * - Invoice must have paid_status = 'unpaid'
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params

    // Auth check - admin only
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get invoice with client info and line items
    const { data: invoice, error: invoiceError } = await adminClient
      .from('invoices_jetpack')
      .select(`
        id,
        invoice_number,
        total_amount,
        status,
        paid_status,
        line_items_json,
        client:clients(
          id,
          company_name,
          stripe_customer_id,
          stripe_payment_method_id
        )
      `)
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Validate invoice state
    if (!['approved', 'sent'].includes(invoice.status)) {
      return NextResponse.json(
        { error: `Cannot charge invoice with status '${invoice.status}'. Must be 'approved' or 'sent'.` },
        { status: 400 }
      )
    }

    if (invoice.paid_status === 'paid') {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 })
    }

    const client = invoice.client as {
      id: string
      company_name: string
      stripe_customer_id: string | null
      stripe_payment_method_id: string | null
    }

    // Validate client has CC setup
    if (!client.stripe_customer_id || !client.stripe_payment_method_id) {
      return NextResponse.json(
        { error: 'Client does not have credit card payment configured' },
        { status: 400 }
      )
    }

    // Check if invoice already has CC fee
    const lineItems = invoice.line_items_json as Array<{ feeType?: string }> | null
    const hasCcFee = lineItems?.some(item => item.feeType === 'Credit Card Processing Fee (3%)')

    // Calculate charge amount
    const baseAmount = parseFloat(invoice.total_amount)
    let chargeAmount: number
    let ccFeeAdded = 0

    if (hasCcFee) {
      // Invoice already has CC fee built in
      chargeAmount = baseAmount
    } else {
      // Add 3% CC processing fee
      ccFeeAdded = Math.round(baseAmount * 0.03 * 100) / 100
      chargeAmount = Math.round((baseAmount + ccFeeAdded) * 100) / 100
    }

    const amountInCents = Math.round(chargeAmount * 100)

    // Ensure minimum charge amount
    if (amountInCents < 50) {
      return NextResponse.json(
        { error: 'Charge amount must be at least $0.50' },
        { status: 400 }
      )
    }

    const stripe = getStripe()

    // Create PaymentIntent and charge immediately
    const description = hasCcFee
      ? `Invoice ${invoice.invoice_number} - ${client.company_name}`
      : `Invoice ${invoice.invoice_number} - ${client.company_name} (includes 3% CC fee)`

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: client.stripe_customer_id,
      payment_method: client.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      description,
      metadata: {
        jetpack_invoice_id: invoiceId,
        jetpack_invoice_number: invoice.invoice_number,
        jetpack_client_id: client.id,
        base_amount: baseAmount.toFixed(2),
        cc_fee_added: ccFeeAdded.toFixed(2),
        total_charged: chargeAmount.toFixed(2),
      },
    })

    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      // Update invoice as paid
      const updateData: Record<string, unknown> = {
        paid_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntent.id,
      }

      // If we added a CC fee, update the total_amount to reflect what was actually charged
      if (!hasCcFee && ccFeeAdded > 0) {
        updateData.total_amount = chargeAmount.toFixed(2)
        // Add CC fee line item to the invoice for record-keeping
        const updatedLineItems = [
          ...(lineItems || []),
          {
            id: `cc-fee-manual-${Date.now()}`,
            billingTable: 'cc_processing_fee',
            billingRecordId: `cc-fee-manual-${client.id}`,
            baseAmount: ccFeeAdded,
            markupApplied: 0,
            billedAmount: ccFeeAdded,
            markupRuleId: null,
            markupPercentage: 0,
            lineCategory: 'Additional Services',
            description: 'Credit Card Processing Fee (3%) - Added at payment',
            feeType: 'Credit Card Processing Fee (3%)',
            transactionDate: new Date().toISOString().split('T')[0],
          }
        ]
        updateData.line_items_json = updatedLineItems
      }

      const { error: updateError } = await adminClient
        .from('invoices_jetpack')
        .update(updateData)
        .eq('id', invoiceId)

      if (updateError) {
        console.error('Error updating invoice paid status:', updateError)
        return NextResponse.json({
          success: true,
          warning: 'Payment succeeded but failed to update invoice status. Please update manually.',
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          amountCharged: chargeAmount,
        })
      }

      console.log(`Charged invoice ${invoice.invoice_number}: $${chargeAmount} (PI: ${paymentIntent.id})${!hasCcFee ? ' [+3% CC fee added]' : ''}`)

      return NextResponse.json({
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        baseAmount,
        ccFeeAdded,
        amountCharged: chargeAmount,
        hasCcFeeInInvoice: hasCcFee,
      })
    } else {
      return NextResponse.json({
        success: false,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        error: `Payment status: ${paymentIntent.status}. May require additional authentication.`,
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Error charging invoice:', error)

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeCardError) {
      return NextResponse.json({
        success: false,
        error: error.message,
        code: error.code,
      }, { status: 400 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to charge invoice' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/invoices/[invoiceId]/charge-cc
 *
 * Preview what would be charged for this invoice.
 * Returns the base amount, CC fee (if any), and total that would be charged.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params

    // Auth check - admin only
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get invoice with client info
    const { data: invoice, error: invoiceError } = await adminClient
      .from('invoices_jetpack')
      .select(`
        id,
        invoice_number,
        total_amount,
        status,
        paid_status,
        line_items_json,
        client:clients(
          id,
          company_name,
          stripe_customer_id,
          stripe_payment_method_id
        )
      `)
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const client = invoice.client as {
      id: string
      company_name: string
      stripe_customer_id: string | null
      stripe_payment_method_id: string | null
    }

    // Check if client has CC setup
    const canCharge = !!(client.stripe_customer_id && client.stripe_payment_method_id)

    // Check if invoice already has CC fee
    const lineItems = invoice.line_items_json as Array<{ feeType?: string }> | null
    const hasCcFee = lineItems?.some(item => item.feeType === 'Credit Card Processing Fee (3%)')

    // Calculate amounts
    const baseAmount = parseFloat(invoice.total_amount)
    const ccFeeToAdd = hasCcFee ? 0 : Math.round(baseAmount * 0.03 * 100) / 100
    const totalToCharge = Math.round((baseAmount + ccFeeToAdd) * 100) / 100

    return NextResponse.json({
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      paidStatus: invoice.paid_status,
      canCharge,
      hasCcFeeInInvoice: hasCcFee,
      baseAmount,
      ccFeeToAdd,
      totalToCharge,
      clientName: client.company_name,
    })
  } catch (error) {
    console.error('Error getting charge preview:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get charge preview' },
      { status: 500 }
    )
  }
}
