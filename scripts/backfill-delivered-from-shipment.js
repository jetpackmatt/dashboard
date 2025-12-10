require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Backfill event_delivered from shipment API's actual_delivery_date field
// For shipments where Timeline API doesn't have the Delivered event

async function main() {
  console.log('=== Backfill event_delivered from actual_delivery_date ===\n')

  // Get client tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_api_credentials(api_token, provider)')

  const tokenMap = {}
  for (const c of clients) {
    const token = c.client_api_credentials?.find(cr => cr.provider === 'shipbob')?.api_token
    if (token) tokenMap[c.id] = token
  }

  // Get Completed shipments without event_delivered that have "Delivered" in status_details
  let all = []
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, client_id, status_details, event_labeled')
      .eq('status', 'Completed')
      .is('event_delivered', null)
      .is('deleted_at', null)
      .range(offset, offset + batchSize - 1)

    if (!data || data.length === 0) break
    all = all.concat(data)
    offset += batchSize
    if (data.length < batchSize) break
  }

  // Filter to only those with "Delivered" in status_details
  const deliveredShipments = all.filter(s => s.status_details?.[0]?.name === 'Delivered')

  console.log('Total Completed without event_delivered:', all.length)
  console.log('With Delivered in status_details:', deliveredShipments.length)
  console.log('')

  let updated = 0, noData = 0, errors = 0

  for (let i = 0; i < deliveredShipments.length; i++) {
    const shipment = deliveredShipments[i]
    const token = tokenMap[shipment.client_id]

    if (!token) {
      console.log(`  No token for client ${shipment.client_id}`)
      errors++
      continue
    }

    try {
      // Fetch shipment details (not timeline)
      const res = await fetch(`https://api.shipbob.com/1.0/shipment/${shipment.shipment_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.status === 429) {
        console.log('  Rate limited, waiting 60s...')
        await new Promise(r => setTimeout(r, 60000))
        i-- // Retry
        continue
      }

      if (!res.ok) {
        console.log(`  API error for ${shipment.shipment_id}: ${res.status}`)
        errors++
        continue
      }

      const data = await res.json()

      if (!data.actual_delivery_date) {
        console.log(`  ${shipment.shipment_id}: No actual_delivery_date in API`)
        noData++
        continue
      }

      // Calculate transit time if we have both dates
      const updateData = {
        event_delivered: data.actual_delivery_date
      }

      const labeledDate = shipment.event_labeled
      if (labeledDate) {
        const labeled = new Date(labeledDate)
        const delivered = new Date(data.actual_delivery_date)
        const transitMs = delivered.getTime() - labeled.getTime()
        updateData.transit_time_days = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10
      }

      // Update shipment
      await supabase
        .from('shipments')
        .update(updateData)
        .eq('shipment_id', shipment.shipment_id)

      console.log(`  Fixed ${shipment.shipment_id}: event_delivered=${data.actual_delivery_date}, transit=${updateData.transit_time_days} days`)
      updated++

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 300))

    } catch (e) {
      console.log(`  Error for ${shipment.shipment_id}: ${e.message}`)
      errors++
    }
  }

  console.log('\n=== Results ===')
  console.log('Updated:', updated)
  console.log('No actual_delivery_date in API:', noData)
  console.log('Errors:', errors)
}

main()
