import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getClient, getClientToken } from '@/lib/supabase/admin'

const SHIPBOB_API_BASE = 'https://api.shipbob.com'

/**
 * POST /api/admin/clients/[clientId]/test-connection
 * Tests that a client's ShipBob token is valid
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

    // Get client
    const client = await getClient(clientId)
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Get token
    const token = await getClientToken(clientId)
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: 'No API token configured for this client',
        },
        { status: 400 }
      )
    }

    // Test the token by fetching orders (lightweight call)
    const testStart = Date.now()

    const response = await fetch(`${SHIPBOB_API_BASE}/1.0/order?Limit=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    const latency = Date.now() - testStart

    if (response.status === 401) {
      return NextResponse.json({
        success: false,
        error: 'Invalid or expired token',
        status: response.status,
        latency,
      })
    }

    if (response.status === 403) {
      return NextResponse.json({
        success: false,
        error: 'Token lacks required permissions',
        status: response.status,
        latency,
      })
    }

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `ShipBob API returned ${response.status}`,
        status: response.status,
        latency,
      })
    }

    // Success - try to get order count
    const data = await response.json()
    const orderCount = Array.isArray(data) ? data.length : 0

    return NextResponse.json({
      success: true,
      message: 'Connection successful',
      client_name: client.company_name,
      shipbob_user_id: client.shipbob_user_id,
      orders_accessible: orderCount > 0,
      latency,
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error testing connection:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to test connection',
      },
      { status: 500 }
    )
  }
}
