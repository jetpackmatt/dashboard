require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // WRO IDs from the unattributed transactions
  const wroIds = ['871028', '870085', '871098', '868192', '869656', '869299', '860986', '861112', '856885']

  console.log('Checking if WRO IDs exist in receiving_orders table...\n')

  const { data: wros } = await supabase
    .from('receiving_orders')
    .select('shipbob_wro_id, client_id, status, clients(company_name)')
    .in('shipbob_wro_id', wroIds)

  console.log('Found in receiving_orders:', wros?.length || 0)
  for (const w of wros || []) {
    console.log('  WRO', w.shipbob_wro_id, '->', w.clients?.company_name || 'no client', '(status:', w.status + ')')
  }

  const foundIds = new Set((wros || []).map(w => w.shipbob_wro_id))
  const missingIds = wroIds.filter(id => !foundIds.has(id))
  if (missingIds.length > 0) {
    console.log('\nNOT in receiving_orders:', missingIds.join(', '))
  }

  // Also check the Credit - reference_id 2880370 (looks like a shipment ID?)
  console.log('\n\nChecking Credit reference_id 2880370...')
  const { data: shipment } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, clients(company_name)')
    .eq('shipment_id', '2880370')
    .single()

  if (shipment) {
    console.log('Found shipment:', shipment.shipment_id, '->', shipment.clients?.company_name)
  } else {
    console.log('Shipment 2880370 not found in shipments table')
  }
}
main().catch(console.error)
