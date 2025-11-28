import { createClient } from "@/lib/supabase/server"
import { SiteHeader } from "@/components/site-header"
import { DashboardContent } from "@/components/dashboard-content"

// Default client ID (Henson Shaving) for non-admin users
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Extract first name from email or use email prefix
  const displayName = user?.user_metadata?.full_name?.split(' ')[0]
    || user?.email?.split('@')[0]
    || 'User'

  // Fetch shipments data from database
  const { data: shipmentsRaw } = await supabase
    .from('billing_shipments')
    .select('*')
    .eq('client_id', DEFAULT_CLIENT_ID)
    .order('transaction_date', { ascending: false })
    .limit(100)

  // Map to DataTable format
  const shipmentsData = (shipmentsRaw || []).map((row: any, index: number) => ({
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

  return (
    <>
      <SiteHeader sectionName={`Welcome Back, ${displayName}`} />
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <DashboardContent
            shipmentsData={shipmentsData}
            additionalServicesData={[]}
            returnsData={[]}
            receivingData={[]}
            storageData={[]}
            creditsData={[]}
          />
        </div>
      </div>
    </>
  )
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
