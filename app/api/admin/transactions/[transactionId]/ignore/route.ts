import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/transactions/[transactionId]/ignore
 *
 * Mark a transaction as ignored (excludes from preflight validation)
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

    const adminClient = createAdminClient()

    // CRITICAL: refuse if the target transaction belongs to a demo client.
    const { data: tx } = await adminClient
      .from('transactions')
      .select('client_id, clients(is_demo)')
      .eq('transaction_id', transactionId)
      .maybeSingle()
    if ((tx?.clients as any)?.is_demo) {
      return NextResponse.json(
        { error: 'Cannot ignore a demo transaction — sales-demo brand' },
        { status: 403 }
      )
    }

    // Update the transaction to mark as ignored
    // Using dispute_status = 'ignored' to exclude from preflight
    const { error: updateError } = await adminClient
      .from('transactions')
      .update({
        dispute_status: 'ignored',
        dispute_reason: 'Manually ignored from preflight validation',
        dispute_created_at: new Date().toISOString(),
      })
      .eq('transaction_id', transactionId)

    if (updateError) {
      console.error('Error ignoring transaction:', updateError)
      return NextResponse.json({ error: 'Failed to ignore transaction' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in ignore transaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
