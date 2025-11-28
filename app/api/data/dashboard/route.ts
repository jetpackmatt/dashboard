import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Default client ID for development (Henson Shaving)
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Get query params
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get('clientId') || DEFAULT_CLIENT_ID
  const limit = parseInt(searchParams.get('limit') || '100')

  try {
    // Fetch recent shipments for the data table (limited for dashboard)
    const { data: shipmentsData, error: shipmentsError, count: shipmentsCount } = await supabase
      .from('billing_shipments')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .order('transaction_date', { ascending: false })
      .limit(limit)

    if (shipmentsError) {
      console.error('Error fetching shipments:', shipmentsError)
      return NextResponse.json({ error: shipmentsError.message }, { status: 500 })
    }

    // Map shipments to DataTable format
    const shipments = (shipmentsData || []).map((row: any, index: number) => ({
      id: row.id || index + 1,
      orderId: String(row.order_id || ''),
      status: mapStatus(row.transaction_status, row.transaction_type),
      customerName: row.customer_name || `Order ${row.order_id}`,
      orderType: row.order_type || 'D2C',
      qty: row.quantity || 1,
      cost: row.total_amount || 0,
      importDate: row.transaction_date || new Date().toISOString(),
      slaDate: calculateSlaDate(row.transaction_date),
    }))

    return NextResponse.json({
      shipmentsData: shipments,
      additionalServicesData: [],
      returnsData: [],
      receivingData: [],
      storageData: [],
      creditsData: [],
      totalShipments: shipmentsCount || 0,
    })
  } catch (err) {
    console.error('Dashboard API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function mapStatus(transactionStatus?: string, transactionType?: string): string {
  if (transactionType === 'Credit' || transactionType === 'Refund') {
    return 'Refunded'
  }
  if (transactionStatus === 'invoiced') {
    return 'Shipped'
  }
  if (transactionStatus === 'invoice pending') {
    return 'Processing'
  }
  return 'Shipped'
}

function calculateSlaDate(transactionDate: string | null): string {
  if (!transactionDate) return new Date().toISOString()
  const date = new Date(transactionDate)
  date.setDate(date.getDate() + 7)
  return date.toISOString()
}
