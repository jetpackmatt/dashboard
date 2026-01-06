import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import Stripe from "stripe"

// Lazy-initialize Stripe client
let stripeClient: Stripe | null = null
function getStripe(): Stripe {
  if (!stripeClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not configured")
    }
    stripeClient = new Stripe(secretKey)
  }
  return stripeClient
}

/**
 * POST /api/stripe/charge-invoice
 *
 * Charges a client's credit card for a specific invoice.
 * Only works for invoices that have CC fee included (payment_method = 'credit_card' at generation time).
 *
 * Request body:
 * - invoiceId: The Jetpack invoice ID to charge
 *
 * Prerequisites:
 * - Client must have stripe_customer_id and stripe_payment_method_id
 * - Invoice must be in 'approved' or 'sent' status
 * - Invoice must have paid_status = 'unpaid'
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check - admin only for manual charges
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { invoiceId } = body

    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Get invoice with client info
    const { data: invoice, error: invoiceError } = await adminClient
      .from("invoices_jetpack")
      .select(`
        id,
        invoice_number,
        total_amount,
        status,
        paid_status,
        client:clients(
          id,
          company_name,
          stripe_customer_id,
          stripe_payment_method_id,
          payment_method
        )
      `)
      .eq("id", invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Validate invoice state
    if (!['approved', 'sent'].includes(invoice.status)) {
      return NextResponse.json(
        { error: `Cannot charge invoice with status '${invoice.status}'. Must be 'approved' or 'sent'.` },
        { status: 400 }
      )
    }

    if (invoice.paid_status === 'paid') {
      return NextResponse.json({ error: "Invoice is already paid" }, { status: 400 })
    }

    const client = invoice.client as {
      id: string
      company_name: string
      stripe_customer_id: string | null
      stripe_payment_method_id: string | null
      payment_method: string | null
    }

    // Validate client has CC setup
    if (!client.stripe_customer_id || !client.stripe_payment_method_id) {
      return NextResponse.json(
        { error: "Client does not have credit card payment configured" },
        { status: 400 }
      )
    }

    // Validate this invoice was generated with CC fee (future invoices for CC clients)
    // Check if the line_items_json contains a CC fee line item
    const { data: invoiceWithItems } = await adminClient
      .from("invoices_jetpack")
      .select("line_items_json")
      .eq("id", invoiceId)
      .single()

    const lineItems = invoiceWithItems?.line_items_json as Array<{ feeType?: string }> | null
    const hasCcFee = lineItems?.some(item => item.feeType === 'Credit Card Processing Fee (3%)')

    if (!hasCcFee) {
      return NextResponse.json(
        { error: "This invoice was not generated with CC fee. Only future invoices can be auto-charged." },
        { status: 400 }
      )
    }

    const stripe = getStripe()

    // Convert amount to cents for Stripe
    const amountInCents = Math.round(parseFloat(invoice.total_amount) * 100)

    // Create PaymentIntent and charge immediately
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: client.stripe_customer_id,
      payment_method: client.stripe_payment_method_id,
      off_session: true, // Charge without customer present
      confirm: true, // Immediately attempt to confirm
      description: `Invoice ${invoice.invoice_number} - ${client.company_name}`,
      metadata: {
        jetpack_invoice_id: invoiceId,
        jetpack_invoice_number: invoice.invoice_number,
        jetpack_client_id: client.id,
      },
    })

    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      // Update invoice as paid
      const { error: updateError } = await adminClient
        .from("invoices_jetpack")
        .update({
          paid_status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: paymentIntent.id,
        })
        .eq("id", invoiceId)

      if (updateError) {
        console.error("Error updating invoice paid status:", updateError)
        // Payment succeeded but DB update failed - log for manual reconciliation
        return NextResponse.json({
          success: true,
          warning: "Payment succeeded but failed to update invoice status. Please update manually.",
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
        })
      }

      console.log(`Charged invoice ${invoice.invoice_number}: $${invoice.total_amount} (PI: ${paymentIntent.id})`)

      return NextResponse.json({
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amountCharged: invoice.total_amount,
      })
    } else {
      // Payment requires additional action or failed
      return NextResponse.json({
        success: false,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        error: `Payment status: ${paymentIntent.status}. May require additional authentication.`,
      }, { status: 400 })
    }
  } catch (error) {
    console.error("Error charging invoice:", error)

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeCardError) {
      return NextResponse.json({
        success: false,
        error: error.message,
        code: error.code,
      }, { status: 400 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to charge invoice" },
      { status: 500 }
    )
  }
}
