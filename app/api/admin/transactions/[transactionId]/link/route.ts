import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/transactions/[transactionId]/link
 *
 * Link an unattributed transaction to a specific client
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { transactionId } = await params
    const body = await request.json()
    const { clientId } = body

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    let targetClientId: string
    let targetMerchantId: number | null = null

    // Handle special Jetpack (Parent) value
    if (clientId === '__jetpack_parent__') {
      const { data: jetpackClient, error: jetpackError } = await adminClient
        .from('clients')
        .select('id, merchant_id')
        .eq('company_name', 'Jetpack')
        .single()

      if (jetpackError || !jetpackClient) {
        return NextResponse.json({ error: 'Jetpack parent client not found' }, { status: 404 })
      }
      targetClientId = jetpackClient.id
      targetMerchantId = jetpackClient.merchant_id
    } else {
      // Get the client's merchant_id
      const { data: client, error: clientError } = await adminClient
        .from('clients')
        .select('id, merchant_id')
        .eq('id', clientId)
        .single()

      if (clientError || !client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
      targetClientId = client.id
      targetMerchantId = client.merchant_id
    }

    // Update the transaction
    const { error: updateError } = await adminClient
      .from('transactions')
      .update({
        client_id: targetClientId,
        merchant_id: targetMerchantId,
      })
      .eq('transaction_id', transactionId)

    if (updateError) {
      console.error('Error linking transaction:', updateError)
      return NextResponse.json({ error: 'Failed to link transaction' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in link transaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
