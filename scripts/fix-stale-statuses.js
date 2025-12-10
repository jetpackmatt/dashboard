require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Fix Stale Shipment Statuses ===\n')

  // Pre-label statuses that shouldn't have event_labeled populated
  const preLabelStatuses = ['None', 'Processing', 'Pending', 'OnHold', 'Exception']

  // Get all shipments with stale status (have event_labeled but status is pre-label)
  const { data: staleShipments } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, status')
    .in('status', preLabelStatuses)
    .not('event_labeled', 'is', null)
    .is('deleted_at', null)
    .order('event_labeled', { ascending: false })

  console.log('Found', staleShipments.length, 'stale shipments to fix')

  // Get client tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_api_credentials(api_token, provider)')

  const tokenMap = {}
  for (const c of clients) {
    const token = c.client_api_credentials?.find(cr => cr.provider === 'shipbob')?.api_token
    if (token) tokenMap[c.id] = token
  }

  let updated = 0, errors = 0
  for (let i = 0; i < staleShipments.length; i++) {
    const shipment = staleShipments[i]
    const token = tokenMap[shipment.client_id]
    if (!token) {
      console.log('  No token for client', shipment.client_id)
      errors++
      continue
    }

    try {
      const res = await fetch('https://api.shipbob.com/1.0/shipment/' + shipment.shipment_id, {
        headers: { Authorization: 'Bearer ' + token }
      })

      if (res.status === 429) {
        console.log('  Rate limited, waiting 60s...')
        await new Promise(r => setTimeout(r, 60000))
        i-- // Retry this one
        continue
      }

      if (!res.ok) {
        console.log('  API error for', shipment.shipment_id, res.status)
        errors++
        continue
      }

      const data = await res.json()

      // Update status, status_details, tracking
      await supabase.from('shipments').update({
        status: data.status,
        status_details: data.status_details || null,
        tracking_id: data.tracking?.tracking_number || null,
        tracking_url: data.tracking?.tracking_url || null,
        carrier: data.tracking?.carrier || null,
      }).eq('shipment_id', shipment.shipment_id)

      console.log('  Fixed', shipment.shipment_id, ':', shipment.status, '->', data.status)
      updated++

      // Slower delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500))
    } catch (e) {
      console.log('  Error:', e.message)
      errors++
    }
  }

  console.log('\n=== Results ===')
  console.log('Updated:', updated)
  console.log('Errors:', errors)
}
main()
