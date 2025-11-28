import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setClientToken, deleteClientToken, hasClientToken, getClient } from '@/lib/supabase/admin'
import { ShipBobClient, getWebhookUrl } from '@/lib/shipbob/client'

/**
 * POST /api/admin/clients/[clientId]/token
 * Set or update a client's API token
 * Also automatically registers webhooks for real-time status updates
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { token } = body

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return NextResponse.json(
        { error: 'API token is required' },
        { status: 400 }
      )
    }

    const trimmedToken = token.trim()

    // Save the token
    await setClientToken(clientId, trimmedToken)

    // Automatically register webhooks for this client
    let webhookResult: { created: boolean; error?: string } = { created: false }
    try {
      const client = await getClient(clientId)
      const shipbob = new ShipBobClient(trimmedToken)
      const webhookUrl = getWebhookUrl()

      const result = await shipbob.webhooks.registerAll(
        webhookUrl,
        `Jetpack Dashboard - ${client?.company_name || clientId}`
      )

      webhookResult = { created: result.created }

      if (result.created) {
        console.log(`[Webhook] Registered webhooks for client ${clientId}`)
      } else {
        console.log(`[Webhook] Webhooks already exist for client ${clientId}`)
      }
    } catch (webhookError) {
      // Don't fail the token save if webhook registration fails
      console.warn(`[Webhook] Failed to register webhooks for client ${clientId}:`, webhookError)
      webhookResult = {
        created: false,
        error: webhookError instanceof Error ? webhookError.message : 'Unknown error'
      }
    }

    return NextResponse.json({
      success: true,
      webhooks: webhookResult
    })
  } catch (error) {
    console.error('Error setting client token:', error)
    return NextResponse.json(
      { error: 'Failed to set client token' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/clients/[clientId]/token
 * Delete a client's API token
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await deleteClientToken(clientId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting client token:', error)
    return NextResponse.json(
      { error: 'Failed to delete client token' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/clients/[clientId]/token
 * Check if a client has a token (doesn't return the actual token)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify user is authenticated
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const has_token = await hasClientToken(clientId)

    return NextResponse.json({ has_token })
  } catch (error) {
    console.error('Error checking client token:', error)
    return NextResponse.json(
      { error: 'Failed to check client token' },
      { status: 500 }
    )
  }
}
