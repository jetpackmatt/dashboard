import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

const PAGE_SIZE = 1000

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  if (!clientId || clientId === 'all') {
    return NextResponse.json({ error: 'A specific client must be selected for analytics' }, { status: 400 })
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  try {
    // Get client name
    const { data: client } = await supabase
      .from('clients')
      .select('company_name')
      .eq('id', clientId)
      .single()

    const merchantName = client?.company_name || 'Unknown'

    // Fetch non-shipping transactions (additional services: pick fees, storage, etc.)
    const allTxs: any[] = []
    let lastId: string | null = null

    while (true) {
      let query = supabase
        .from('transactions')
        .select('id, reference_id, fee_type, billed_amount, charge_date')
        .eq('client_id', clientId)
        .neq('fee_type', 'Shipping')
        .neq('transaction_type', 'Refund')
        .or('is_voided.is.null,is_voided.eq.false')
        .gte('charge_date', startDate)
        .lte('charge_date', endDate + 'T23:59:59.999Z')
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)

      if (lastId) {
        query = query.gt('id', lastId)
      }

      const { data, error } = await query
      if (error) {
        console.error('Error fetching analytics services:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!data || data.length === 0) break

      allTxs.push(...data)
      lastId = data[data.length - 1].id

      if (data.length < PAGE_SIZE) break
    }

    const shaped = allTxs.map(tx => ({
      userId: clientId,
      merchantName,
      referenceId: tx.reference_id || '',
      feeType: tx.fee_type || '',
      invoiceAmount: tx.billed_amount != null ? parseFloat(tx.billed_amount) : 0,
      transactionDate: tx.charge_date ? tx.charge_date.split('T')[0] : '',
    }))

    return NextResponse.json({ data: shaped })
  } catch (error) {
    console.error('Analytics services error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
