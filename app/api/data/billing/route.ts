import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient, verifyClientAccess, handleAccessError } from "@/lib/supabase/admin"

// Update payment method or billing emails
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { clientId, paymentMethod, stripePaymentMethodId, billing_emails } = body

    // Get clientId from body or query params
    const searchParams = request.nextUrl.searchParams
    const requestedClientId = clientId || searchParams.get('clientId')

    // CRITICAL SECURITY: Verify user has access to requested client
    let finalClientId: string | null
    try {
      const access = await verifyClientAccess(requestedClientId)
      finalClientId = access.requestedClientId
    } catch (error) {
      return handleAccessError(error)
    }

    const adminClient = createAdminClient()

    // Handle billing_emails update
    if (billing_emails !== undefined) {
      // Validate array
      if (!Array.isArray(billing_emails)) {
        return NextResponse.json(
          { error: 'billing_emails must be an array' },
          { status: 400 }
        )
      }

      // Require at least one email
      if (billing_emails.length === 0) {
        return NextResponse.json(
          { error: 'At least one billing email is required' },
          { status: 400 }
        )
      }

      // Validate each email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      for (const email of billing_emails) {
        if (!emailRegex.test(email)) {
          return NextResponse.json(
            { error: `Invalid email format: ${email}` },
            { status: 400 }
          )
        }
      }

      // Max 10 emails
      if (billing_emails.length > 10) {
        return NextResponse.json(
          { error: 'Maximum 10 email addresses allowed' },
          { status: 400 }
        )
      }

      // Update database
      const { data, error } = await adminClient
        .from('clients')
        .update({ billing_emails: billing_emails })
        .eq('id', finalClientId)
        .select()

      if (error) {
        console.error('Failed to update billing_emails:', error)
        return NextResponse.json(
          { error: 'Failed to update billing emails' },
          { status: 500 }
        )
      }

      return NextResponse.json({ success: true })
    }

    // Handle payment method update
    if (!paymentMethod || !['ach', 'credit_card'].includes(paymentMethod)) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 })
    }

    // Build update object
    const updateData: Record<string, string | null> = {
      payment_method: paymentMethod,
    }

    // If switching to credit card and we have a payment method ID, save it
    if (paymentMethod === 'credit_card' && stripePaymentMethodId) {
      updateData.stripe_payment_method_id = stripePaymentMethodId
    }

    // If switching back to ACH, clear the payment method ID
    if (paymentMethod === 'ach') {
      updateData.stripe_payment_method_id = null
    }

    const { error } = await adminClient
      .from("clients")
      .update(updateData)
      .eq("id", finalClientId)

    if (error) {
      console.error("Error updating payment method:", error)
      return NextResponse.json({ error: "Failed to update payment method" }, { status: 500 })
    }

    return NextResponse.json({ success: true, paymentMethod })
  } catch (error) {
    console.error("Error in billing PATCH:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const requestedClientId = searchParams.get("clientId")

    // CRITICAL SECURITY: Verify user has access to requested client
    let clientId: string | null
    try {
      const access = await verifyClientAccess(requestedClientId)
      clientId = access.requestedClientId
    } catch (error) {
      return handleAccessError(error)
    }

    const adminClient = createAdminClient()

    // Get client billing info
    const { data: client, error: clientError } = await adminClient
      .from("clients")
      .select("billing_address, billing_email, billing_emails, company_name, payment_method")
      .eq("id", clientId)
      .single()

    if (clientError) {
      console.error("Error fetching client:", clientError)
      return NextResponse.json({ error: "Failed to fetch client" }, { status: 500 })
    }

    // Get unpaid invoices (approved or sent, with paid_status = 'unpaid')
    const { data: unpaidInvoices, error: invoicesError } = await adminClient
      .from("invoices_jetpack")
      .select("id, invoice_number, total_amount, invoice_date, paid_status")
      .eq("client_id", clientId)
      .in("status", ["approved", "sent"])
      .eq("paid_status", "unpaid")
      .order("invoice_date", { ascending: false })

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError)
      return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 })
    }

    // Calculate outstanding balance
    const outstandingBalance = (unpaidInvoices || []).reduce(
      (sum: number, inv: { total_amount: string | null }) => sum + (parseFloat(inv.total_amount || '0') || 0),
      0
    )

    return NextResponse.json({
      billingAddress: client?.billing_address || null,
      billingEmail: client?.billing_email || null,
      billingEmails: client?.billing_emails || [],
      companyName: client?.company_name || null,
      paymentMethod: client?.payment_method || 'ach',
      outstandingBalance,
      unpaidInvoiceCount: unpaidInvoices?.length || 0,
      unpaidInvoices: unpaidInvoices || [],
    })
  } catch (error) {
    console.error("Error in billing API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
