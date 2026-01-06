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
      console.error("STRIPE_SECRET_KEY is not set. Available env vars:", Object.keys(process.env).filter(k => k.includes('STRIPE')))
      throw new Error("STRIPE_SECRET_KEY environment variable is not configured")
    }
    stripeClient = new Stripe(secretKey)
  }
  return stripeClient
}

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { clientId } = body

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Get client info
    const { data: client, error: clientError } = await adminClient
      .from("clients")
      .select("id, company_name, billing_email, stripe_customer_id")
      .eq("id", clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    let stripeCustomerId = client.stripe_customer_id

    const stripe = getStripe()

    // Create Stripe customer if doesn't exist
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: client.company_name,
        email: client.billing_email || undefined,
        metadata: {
          jetpack_client_id: clientId,
        },
      })

      stripeCustomerId = customer.id

      // Save Stripe customer ID to our DB
      await adminClient
        .from("clients")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", clientId)
    }

    // Create SetupIntent for collecting card details
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      usage: "off_session", // Allow charging later without customer present
      metadata: {
        jetpack_client_id: clientId,
      },
    })

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId: stripeCustomerId,
    })
  } catch (error) {
    console.error("Error creating SetupIntent:", error)
    return NextResponse.json({ error: "Failed to create setup intent" }, { status: 500 })
  }
}
