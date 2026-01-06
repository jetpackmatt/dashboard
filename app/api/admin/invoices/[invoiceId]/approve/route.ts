import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  markTransactionsAsInvoiced,
  type InvoiceLineItem,
} from '@/lib/billing/invoice-generator'
import Stripe from 'stripe'

// Lazy-initialize Stripe client
let stripeClient: Stripe | null = null
function getStripe(): Stripe | null {
  if (!stripeClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      console.warn("STRIPE_SECRET_KEY not configured - auto-charging disabled")
      return null
    }
    stripeClient = new Stripe(secretKey)
  }
  return stripeClient
}

/**
 * POST /api/admin/invoices/[invoiceId]/approve
 *
 * Approve a draft invoice, making it final.
 *
 * IMPORTANT: This does NOT recalculate markups. It reads the pre-calculated
 * line_items_json that was stored during generation. This ensures the amounts
 * marked on transactions are EXACTLY what was shown in the PDF/XLS files
 * that were reviewed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params

    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get current invoice with client info (including Stripe fields for auto-charge)
    const { data: invoice, error: fetchError } = await adminClient
      .from('invoices_jetpack')
      .select('*, client:clients(id, company_name, short_code, stripe_customer_id, stripe_payment_method_id, payment_method)')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot approve invoice with status: ${invoice.status}` },
        { status: 400 }
      )
    }

    // Get cached line items from generation - these are the EXACT amounts shown in PDF/XLS
    const lineItems: InvoiceLineItem[] = invoice.line_items_json || []
    const shipbobInvoiceIds: number[] = invoice.shipbob_invoice_ids || []

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'No cached line items found. This invoice may need to be regenerated.' },
        { status: 400 }
      )
    }

    // Get optional approval notes from request body
    let approvalNotes = null
    try {
      const body = await request.json()
      approvalNotes = body.notes || null
    } catch {
      // No body provided, that's fine
    }

    const client = invoice.client
    console.log(`Approving invoice ${invoice.invoice_number} for ${client.company_name}`)
    console.log(`  Using ${lineItems.length} cached line items (no recalculation)`)

    // Step 1: Mark transactions as invoiced using cached markup data
    // Pass invoice_date so transactions have the proper invoice date recorded
    const markResult = await markTransactionsAsInvoiced(lineItems, invoice.invoice_number, invoice.invoice_date)
    console.log(`  Marked ${markResult.updated} transactions`)
    if (markResult.errors.length > 0) {
      console.warn(`  Errors marking transactions:`, markResult.errors.slice(0, 5))
    }

    // Step 2: Mark ShipBob invoices (invoices_sb) with this Jetpack invoice number
    const { error: sbMarkError } = await adminClient
      .from('invoices_sb')
      .update({ jetpack_invoice_id: invoice.invoice_number })
      .in('shipbob_invoice_id', shipbobInvoiceIds.map(String))

    if (sbMarkError) {
      console.error('Error marking ShipBob invoices:', sbMarkError)
      // Don't fail the approval, but log it
    } else {
      console.log(`  Marked ${shipbobInvoiceIds.length} ShipBob invoices as processed`)
    }

    // Step 3: Update invoice to approved
    const { data: updatedInvoice, error: updateError } = await adminClient
      .from('invoices_jetpack')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        approval_notes: approvalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (updateError) {
      console.error('Error approving invoice:', updateError)
      return NextResponse.json({ error: 'Failed to approve invoice' }, { status: 500 })
    }

    console.log(`Invoice ${invoice.invoice_number} approved successfully`)

    // Step 4: Auto-charge if client has CC configured and invoice has CC fee
    let chargeResult: { success: boolean; paymentIntentId?: string; error?: string } | null = null

    const hasCcFee = lineItems.some(item => item.feeType === 'Credit Card Processing Fee (3%)')
    const clientData = client as {
      id: string
      company_name: string
      short_code: string
      stripe_customer_id: string | null
      stripe_payment_method_id: string | null
      payment_method: string | null
    }

    if (hasCcFee && clientData.stripe_customer_id && clientData.stripe_payment_method_id) {
      console.log(`  Attempting auto-charge for CC invoice...`)

      const stripe = getStripe()
      if (stripe) {
        try {
          const amountInCents = Math.round(parseFloat(invoice.total_amount) * 100)

          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            customer: clientData.stripe_customer_id,
            payment_method: clientData.stripe_payment_method_id,
            off_session: true,
            confirm: true,
            description: `Invoice ${invoice.invoice_number} - ${clientData.company_name}`,
            metadata: {
              jetpack_invoice_id: invoiceId,
              jetpack_invoice_number: invoice.invoice_number,
              jetpack_client_id: clientData.id,
            },
          })

          if (paymentIntent.status === 'succeeded') {
            // Update invoice as paid
            await adminClient
              .from('invoices_jetpack')
              .update({
                paid_status: 'paid',
                paid_at: new Date().toISOString(),
                stripe_payment_intent_id: paymentIntent.id,
              })
              .eq('id', invoiceId)

            console.log(`  Auto-charge successful: $${invoice.total_amount} (PI: ${paymentIntent.id})`)
            chargeResult = { success: true, paymentIntentId: paymentIntent.id }
          } else {
            console.warn(`  Auto-charge incomplete: status=${paymentIntent.status}`)
            chargeResult = { success: false, error: `Payment status: ${paymentIntent.status}` }
          }
        } catch (chargeError) {
          const errorMessage = chargeError instanceof Error ? chargeError.message : 'Unknown error'
          console.error(`  Auto-charge failed:`, errorMessage)
          chargeResult = { success: false, error: errorMessage }
          // Don't fail the approval - the invoice is approved, just not paid
        }
      }
    }

    return NextResponse.json({
      success: true,
      invoice: updatedInvoice,
      transactionsMarked: markResult.updated,
      shipbobInvoicesMarked: shipbobInvoiceIds.length,
      autoCharge: chargeResult,
    })
  } catch (error) {
    console.error('Error in invoice approval:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
