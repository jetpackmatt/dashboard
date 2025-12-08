/**
 * Audit script to compare API data with database records
 * Verifies that sync is working correctly
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(80))
  console.log('SYNC AUDIT - Comparing API vs Database')
  console.log('='.repeat(80))

  // Get active client with token
  const { data: clients } = await supabase
    .from('clients')
    .select(`
      id,
      company_name,
      client_api_credentials (api_token, provider)
    `)
    .eq('is_active', true)
    .limit(1)

  const client = clients?.[0]
  const shipbobCred = client?.client_api_credentials?.find(c => c.provider === 'shipbob')

  if (!shipbobCred?.api_token) {
    console.log('No client with ShipBob token found')
    return
  }

  console.log('Using client:', client.company_name)
  const clientToken = shipbobCred.api_token

  // Fetch recent order from API
  const apiListRes = await fetch(`https://api.shipbob.com/2025-07/order?Limit=1&SortOrder=Newest`, {
    headers: { Authorization: `Bearer ${clientToken}` }
  })

  const apiOrders = await apiListRes.json()
  if (!apiOrders || apiOrders.length === 0) {
    console.log('No orders from API')
    return
  }

  const apiOrder = apiOrders[0]
  const orderId = apiOrder.id
  console.log('\nSample Order ID:', orderId)

  // Get corresponding DB record
  const { data: dbOrders } = await supabase
    .from('orders')
    .select('*')
    .eq('shipbob_order_id', orderId.toString())
    .limit(1)

  if (!dbOrders || dbOrders.length === 0) {
    console.log('Order not found in database - sync may be lagging')
    return
  }

  const dbOrder = dbOrders[0]

  console.log('\n' + '='.repeat(80))
  console.log('ORDER FIELD MAPPING')
  console.log('='.repeat(80))

  const orderMapping = [
    ['API Field', 'DB Column', 'API Value', 'DB Value', 'Match'],
    ['-'.repeat(25), '-'.repeat(25), '-'.repeat(25), '-'.repeat(25), '-'.repeat(5)],
    ['id', 'shipbob_order_id', apiOrder.id, dbOrder.shipbob_order_id],
    ['order_number', 'store_order_id', apiOrder.order_number, dbOrder.store_order_id],
    ['status', 'status', apiOrder.status, dbOrder.status],
    ['created_date', 'order_import_date', apiOrder.created_date?.slice(0, 19), dbOrder.order_import_date?.slice(0, 19)],
    ['purchase_date', 'purchase_date', apiOrder.purchase_date?.slice(0, 10), dbOrder.purchase_date?.slice(0, 10)],
    ['type', 'order_type', apiOrder.type, dbOrder.order_type],
    ['channel.id', 'channel_id', apiOrder.channel?.id, dbOrder.channel_id],
    ['channel.name', 'channel_name', apiOrder.channel?.name, dbOrder.channel_name],
    ['recipient.name', 'customer_name', apiOrder.recipient?.name, dbOrder.customer_name],
    ['recipient.email', 'customer_email', apiOrder.recipient?.email, dbOrder.customer_email],
    ['recipient.address.address1', 'address1', apiOrder.recipient?.address?.address1, dbOrder.address1],
    ['recipient.address.city', 'city', apiOrder.recipient?.address?.city, dbOrder.city],
    ['recipient.address.state', 'state', apiOrder.recipient?.address?.state, dbOrder.state],
    ['recipient.address.zip_code', 'zip_code', apiOrder.recipient?.address?.zip_code, dbOrder.zip_code],
    ['recipient.address.country', 'country', apiOrder.recipient?.address?.country, dbOrder.country],
    ['financials.total_price', 'total_price', apiOrder.financials?.total_price, dbOrder.total_price],
    ['shipping_method', 'shipping_method', apiOrder.shipping_method, dbOrder.shipping_method],
    ['reference_id', 'reference_id', apiOrder.reference_id, dbOrder.reference_id],
    ['carrier.type', 'carrier_type', apiOrder.carrier?.type, dbOrder.carrier_type],
    ['carrier.payment_term', 'payment_term', apiOrder.carrier?.payment_term, dbOrder.payment_term],
    ['shipments.length', 'total_shipments', apiOrder.shipments?.length || 0, dbOrder.total_shipments],
  ]

  for (const row of orderMapping) {
    if (row.length === 5) {
      console.log(`${row[0].padEnd(25)} ${row[1].padEnd(25)} ${row[2].padEnd(25)} ${row[3].padEnd(25)} ${row[4]}`)
    } else {
      const apiVal = String(row[2] ?? 'null')
      const dbVal = String(row[3] ?? 'null')
      const match = apiVal === dbVal ? '✅' : '❌'
      console.log(`${row[0].padEnd(25)} ${row[1].padEnd(25)} ${apiVal.slice(0, 25).padEnd(25)} ${dbVal.slice(0, 25).padEnd(25)} ${match}`)
    }
  }

  // Check shipment
  if (apiOrder.shipments && apiOrder.shipments.length > 0) {
    const apiShipment = apiOrder.shipments[0]

    const { data: dbShipments } = await supabase
      .from('shipments')
      .select('*')
      .eq('shipment_id', apiShipment.id.toString())
      .limit(1)

    if (dbShipments && dbShipments.length > 0) {
      const dbShipment = dbShipments[0]

      console.log('\n' + '='.repeat(80))
      console.log('SHIPMENT FIELD MAPPING - ID:', apiShipment.id)
      console.log('='.repeat(80))

      const shipmentMapping = [
        ['API Field', 'DB Column', 'API Value', 'DB Value', 'Match'],
        ['-'.repeat(30), '-'.repeat(25), '-'.repeat(25), '-'.repeat(25), '-'.repeat(5)],
        ['id', 'shipment_id', apiShipment.id, dbShipment.shipment_id],
        ['status', 'status', apiShipment.status, dbShipment.status],
        ['tracking.tracking_number', 'tracking_id', apiShipment.tracking?.tracking_number, dbShipment.tracking_id],
        ['tracking.carrier', 'carrier', apiShipment.tracking?.carrier, dbShipment.carrier],
        ['ship_option', 'carrier_service', apiShipment.ship_option, dbShipment.carrier_service],
        ['location.name', 'fc_name', apiShipment.location?.name, dbShipment.fc_name],
        ['zone.id', 'zone_used', apiShipment.zone?.id, dbShipment.zone_used],
        ['measurements.total_weight_oz', 'actual_weight_oz', apiShipment.measurements?.total_weight_oz, dbShipment.actual_weight_oz],
        ['measurements.length_in', 'length', apiShipment.measurements?.length_in, dbShipment.length],
        ['measurements.width_in', 'width', apiShipment.measurements?.width_in, dbShipment.width],
        ['measurements.depth_in', 'height', apiShipment.measurements?.depth_in, dbShipment.height],
        ['recipient.name', 'recipient_name', apiShipment.recipient?.name || apiShipment.recipient?.full_name, dbShipment.recipient_name],
        ['created_date', 'label_generation_date', apiShipment.created_date?.slice(0, 19), dbShipment.label_generation_date?.slice(0, 19)],
        ['actual_fulfillment_date', 'shipped_date', apiShipment.actual_fulfillment_date?.slice(0, 19), dbShipment.shipped_date?.slice(0, 19)],
        ['delivery_date', 'delivered_date', apiShipment.delivery_date?.slice(0, 19), dbShipment.delivered_date?.slice(0, 19)],
        ['invoice.amount', 'invoice_amount', apiShipment.invoice?.amount, dbShipment.invoice_amount],
        ['invoice.currency_code', 'invoice_currency_code', apiShipment.invoice?.currency_code, dbShipment.invoice_currency_code],
        ['insurance_value', 'insurance_value', apiShipment.insurance_value, dbShipment.insurance_value],
        ['require_signature', 'require_signature', apiShipment.require_signature, dbShipment.require_signature],
        ['package_material_type', 'package_material_type', apiShipment.package_material_type, dbShipment.package_material_type],
      ]

      for (const row of shipmentMapping) {
        if (row.length === 5) {
          console.log(`${row[0].padEnd(30)} ${row[1].padEnd(25)} ${row[2].padEnd(25)} ${row[3].padEnd(25)} ${row[4]}`)
        } else {
          const apiVal = String(row[2] ?? 'null')
          const dbVal = String(row[3] ?? 'null')
          const match = apiVal === dbVal ? '✅' : (apiVal === 'undefined' && dbVal === 'null' ? '✅' : '❌')
          console.log(`${row[0].padEnd(30)} ${row[1].padEnd(25)} ${apiVal.slice(0, 25).padEnd(25)} ${dbVal.slice(0, 25).padEnd(25)} ${match}`)
        }
      }

      console.log('\n--- COMPUTED FIELDS (not in API) ---')
      console.log(`transit_time_days: ${dbShipment.transit_time_days} (shipped_date -> delivered_date)`)
      console.log(`dim_weight_oz: ${dbShipment.dim_weight_oz} (L*W*H / dim_divisor * 16)`)
      console.log(`billable_weight_oz: ${dbShipment.billable_weight_oz} (max of actual/dim)`)
      console.log(`origin_country: ${dbShipment.origin_country} (from FC lookup)`)
      console.log(`destination_country: ${dbShipment.destination_country} (from order address)`)
    }
  }

  // Check transaction
  console.log('\n' + '='.repeat(80))
  console.log('SAMPLE TRANSACTION')
  console.log('='.repeat(80))

  const { data: dbTx } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_type', 'Shipment')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (dbTx) {
    // Fetch from API
    const txRes = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SHIPBOB_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reference_ids: [dbTx.reference_id],
        page_size: 100
      })
    })

    const txData = await txRes.json()
    const apiTx = txData.items?.find(t => t.transaction_id === dbTx.transaction_id)

    if (apiTx) {
      const txMapping = [
        ['API Field', 'DB Column', 'API Value', 'DB Value', 'Match'],
        ['-'.repeat(25), '-'.repeat(25), '-'.repeat(25), '-'.repeat(25), '-'.repeat(5)],
        ['transaction_id', 'transaction_id', apiTx.transaction_id, dbTx.transaction_id],
        ['reference_id', 'reference_id', apiTx.reference_id, dbTx.reference_id],
        ['reference_type', 'reference_type', apiTx.reference_type, dbTx.reference_type],
        ['transaction_fee', 'transaction_fee', apiTx.transaction_fee, dbTx.transaction_fee],
        ['amount', 'amount', apiTx.amount, dbTx.amount],
        ['charge_date', 'charge_date', apiTx.charge_date, dbTx.charge_date],
        ['invoiced_status', 'invoiced_status_sb', apiTx.invoiced_status, dbTx.invoiced_status_sb],
        ['invoice_id', 'invoice_id_sb', apiTx.invoice_id, dbTx.invoice_id_sb],
        ['fulfillment_center', 'fulfillment_center', apiTx.fulfillment_center, dbTx.fulfillment_center],
      ]

      for (const row of txMapping) {
        if (row.length === 5) {
          console.log(`${row[0].padEnd(25)} ${row[1].padEnd(25)} ${row[2].padEnd(25)} ${row[3].padEnd(25)} ${row[4]}`)
        } else {
          const apiVal = String(row[2] ?? 'null')
          const dbVal = String(row[3] ?? 'null')
          const match = apiVal === dbVal ? '✅' : '❌'
          console.log(`${row[0].padEnd(25)} ${row[1].padEnd(25)} ${apiVal.slice(0, 25).padEnd(25)} ${dbVal.slice(0, 25).padEnd(25)} ${match}`)
        }
      }

      console.log('\n--- JETPACK-ADDED FIELDS (not in API) ---')
      console.log(`client_id: ${dbTx.client_id} (attributed from shipment lookup)`)
      console.log(`invoiced_status_jp: ${dbTx.invoiced_status_jp} (Jetpack invoice status)`)
      console.log(`invoice_id_jp: ${dbTx.invoice_id_jp} (Jetpack invoice ID)`)
    }
  }
}

main().catch(console.error)
