import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params

  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get the request body to determine the new status
    const body = await request.json()
    const { paid } = body

    // Get current invoice
    const { data: invoice, error: fetchError } = await adminClient
      .from('invoices_jetpack')
      .select('id, status, paid_status')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Only allow toggling paid_status for approved/sent invoices
    if (invoice.status === 'draft') {
      return NextResponse.json(
        { error: 'Cannot mark draft invoice as paid' },
        { status: 400 }
      )
    }

    const newPaidStatus = paid ? 'paid' : 'unpaid'

    // Update the invoice paid_status
    const { error: updateError } = await adminClient
      .from('invoices_jetpack')
      .update({ paid_status: newPaidStatus })
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Error updating invoice status:', updateError)
      return NextResponse.json(
        { error: 'Failed to update invoice status' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, paid_status: newPaidStatus })
  } catch (error) {
    console.error('Error in paid status update:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
