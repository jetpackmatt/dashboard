/**
 * Check data availability for blank columns
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // Check quantity distribution
  const { data: items } = await supabase
    .from('shipment_items')
    .select('quantity')
    .limit(1000)

  const withQuantity = items.filter(i => i.quantity != null && i.quantity > 0)
  console.log('shipment_items sample (1000):')
  console.log('  With quantity > 0:', withQuantity.length)
  console.log('  NULL/0 quantity:', items.length - withQuantity.length)

  // Check event_created distribution for the invoice period
  const clientId = (await supabase.from('clients').select('id').ilike('company_name', '%henson%').single()).data.id
  const { data: shipments } = await supabase
    .from('shipments')
    .select('event_created, event_labeled')
    .eq('client_id', clientId)
    .gte('created_at', '2025-11-24')
    .lte('created_at', '2025-11-30')
    .limit(500)

  const withEventCreated = shipments?.filter(s => s.event_created) || []
  console.log('')
  console.log('Shipments Nov 24-30 (sample 500):')
  console.log('  Total:', shipments?.length || 0)
  console.log('  With event_created:', withEventCreated.length)
  console.log('  Without event_created:', (shipments?.length || 0) - withEventCreated.length)
}
main()
