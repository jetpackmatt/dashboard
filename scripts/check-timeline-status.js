require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Timeline Status ===\n')

  // Total completed shipments
  const { count: totalCompleted } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Completed')
    .is('deleted_at', null)

  // With event_delivered
  const { count: withDelivered } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Completed')
    .not('event_delivered', 'is', null)
    .is('deleted_at', null)

  const pct = totalCompleted ? ((withDelivered / totalCompleted) * 100).toFixed(1) : 0

  console.log('Total Completed shipments:', totalCompleted)
  console.log('With event_delivered:', withDelivered)
  console.log('Percentage:', pct + '%')
  console.log('Missing:', totalCompleted - withDelivered)

  // Breakdown by client
  console.log('\n=== By Client ===\n')

  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('is_active', true)

  for (const client of clients || []) {
    const { count: clientTotal } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('status', 'Completed')
      .is('deleted_at', null)

    const { count: clientWithDelivered } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('status', 'Completed')
      .not('event_delivered', 'is', null)
      .is('deleted_at', null)

    if (clientTotal > 0) {
      const clientPct = ((clientWithDelivered / clientTotal) * 100).toFixed(1)
      const missing = clientTotal - clientWithDelivered
      console.log(`${client.company_name}: ${clientPct}% (${clientWithDelivered}/${clientTotal}, missing: ${missing})`)
    }
  }
}

main().catch(console.error)
