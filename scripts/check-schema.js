/**
 * Check transactions and shipments schema
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  // Get a sample transaction to see columns
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .limit(1)

  if (error) {
    console.log('Transaction Error:', error)
  } else {
    console.log('Transaction columns:', Object.keys(data[0] || {}))
  }

  // Check shipments table - that's where jetpack_invoice_id might be
  const { data: shipment, error: shipErr } = await supabase
    .from('shipments')
    .select('*')
    .limit(1)

  if (shipErr) {
    console.log('\nShipment Error:', shipErr)
  } else if (shipment && shipment.length > 0) {
    console.log('\nShipment columns:', Object.keys(shipment[0]))

    // Check if jetpack_invoice_id exists on shipments
    if (shipment[0].jetpack_invoice_id !== undefined) {
      console.log('\njetpack_invoice_id exists on shipments!')

      // Count shipments with jetpack_invoice_id
      const { data: withInvoice, count } = await supabase
        .from('shipments')
        .select('shipment_id', { count: 'exact' })
        .not('jetpack_invoice_id', 'is', null)

      console.log('Shipments with jetpack_invoice_id:', count)

      // Sample a few
      const { data: sample } = await supabase
        .from('shipments')
        .select('shipment_id, jetpack_invoice_id, ship_date')
        .not('jetpack_invoice_id', 'is', null)
        .limit(5)

      console.log('Sample:', sample)
    }
  }
}

check().catch(console.error)
