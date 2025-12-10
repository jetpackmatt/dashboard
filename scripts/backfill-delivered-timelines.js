require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Backfill timeline events for shipments that show "Delivered" in status_details
// but are missing event_delivered timestamp (needed for transit time calculation)

async function main() {
  console.log('=== Backfill Delivered Timelines ===\n')

  // Get client tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_api_credentials(api_token, provider)')

  const tokenMap = {}
  for (const c of clients) {
    const token = c.client_api_credentials?.find(cr => cr.provider === 'shipbob')?.api_token
    if (token) tokenMap[c.id] = token
  }

  // Get Completed shipments without event_delivered, paginated
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

  let updated = 0, errors = 0, noData = 0

  for (let i = 0; i < deliveredShipments.length; i++) {
    const shipment = deliveredShipments[i]
    const token = tokenMap[shipment.client_id]

    if (!token) {
      console.log(`  No token for client ${shipment.client_id}`)
      errors++
      continue
    }

    try {
      // Fetch timeline from ShipBob
      const res = await fetch(`https://api.shipbob.com/1.0/shipment/${shipment.shipment_id}/timeline`, {
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

      const timeline = await res.json()

      // Parse timeline events
      const updateData = {}
      let foundDelivered = false

      for (const event of timeline) {
        const eventName = event.log_type_name
        const eventTime = event.timestamp

        if (!eventTime) continue

        switch (eventName) {
          case 'Inserted':
            updateData.event_created = eventTime
            break
          case 'Validated':
            updateData.event_validated = eventTime
            break
          case 'Picked':
            updateData.event_picked = eventTime
            break
          case 'Packed':
            updateData.event_packed = eventTime
            break
          case 'Labeled':
            updateData.event_labeled = eventTime
            break
          case 'InTransit':
            updateData.event_intransit = eventTime
            break
          case 'OutForDelivery':
            updateData.event_outfordelivery = eventTime
            break
          case 'Delivered':
            updateData.event_delivered = eventTime
            foundDelivered = true
            break
        }
      }

      if (!foundDelivered) {
        // Timeline doesn't have Delivered event yet (status_details might be ahead)
        console.log(`  ${shipment.shipment_id}: No Delivered event in timeline (yet)`)
        noData++
        continue
      }

      // Calculate transit time if we have both event_labeled and event_delivered
      const labeledDate = updateData.event_labeled || shipment.event_labeled
      const deliveredDate = updateData.event_delivered

      if (labeledDate && deliveredDate) {
        const labeled = new Date(labeledDate)
        const delivered = new Date(deliveredDate)
        const transitMs = delivered.getTime() - labeled.getTime()
        updateData.transit_time_days = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10
      }

      // Update shipment
      await supabase
        .from('shipments')
        .update(updateData)
        .eq('shipment_id', shipment.shipment_id)

      console.log(`  Fixed ${shipment.shipment_id}: event_delivered=${deliveredDate}, transit=${updateData.transit_time_days} days`)
      updated++

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 200))

    } catch (e) {
      console.log(`  Error for ${shipment.shipment_id}: ${e.message}`)
      errors++
    }
  }

  console.log('\n=== Results ===')
  console.log('Updated:', updated)
  console.log('No Delivered event in timeline:', noData)
  console.log('Errors:', errors)
}

main()
