require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Checking Eli Health Client ===\n')

  // Check if Eli Health exists in clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, is_active')
    .ilike('company_name', '%eli%')

  console.log('Clients matching "eli":')
  for (const c of clients || []) {
    console.log('  ', c.id, '|', c.company_name, '| merchant_id:', c.merchant_id, '| active:', c.is_active)
  }

  // Check if the WRO IDs exist in receiving_orders now
  const wroIds = [871098, 868192]
  console.log('\n=== Checking WRO IDs in receiving_orders ===\n')

  const { data: wros } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id, purchase_order_number')
    .in('shipbob_receiving_id', wroIds)

  console.log('WROs found:', wros?.length || 0)
  for (const wro of wros || []) {
    console.log('  WRO', wro.shipbob_receiving_id, '-> client_id:', wro.client_id, '| merchant:', wro.merchant_id)
  }

  // Check if 2880370 is a return ID
  console.log('\n=== Checking if 2880370 is a Return ID ===\n')

  const { data: returnData } = await supabase
    .from('returns')
    .select('id, shipbob_return_id, client_id')
    .eq('shipbob_return_id', 2880370)

  if (returnData && returnData.length > 0) {
    console.log('Found! 2880370 IS a Return ID')
    console.log('  client_id:', returnData[0].client_id)
  } else {
    console.log('2880370 NOT found in returns table')
  }

  // Also check if it's in shipments just to confirm
  const { data: shipmentData } = await supabase
    .from('shipments')
    .select('id, shipment_id, client_id')
    .eq('shipment_id', '2880370')

  if (shipmentData && shipmentData.length > 0) {
    console.log('\nAlso found as Shipment ID:', shipmentData[0].shipment_id)
  } else {
    console.log('\nNOT found in shipments table - confirms it\'s a return, not a shipment')
  }
}

main().catch(console.error)
