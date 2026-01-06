import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Update payment method
export async function PATCH(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { clientId, paymentMethod, stripePaymentMethodId } = body

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 })
    }

    if (!paymentMethod || !['ach', 'credit_card'].includes(paymentMethod)) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 })
    }

    const adminClient = createAdminClient()

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
      .eq("id", clientId)

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
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }

  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get client billing info
    const { data: client, error: clientError } = await adminClient
      .from("clients")
      .select("billing_address, billing_email, company_name, payment_method")
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
