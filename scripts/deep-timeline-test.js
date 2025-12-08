/**
 * Deep investigation of Timeline API across different time periods
 * Testing if older shipments truly have no data or if there's a bug
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('DEEP INVESTIGATION: TIMELINE API FOR OLDER SHIPMENTS')
  console.log('='.repeat(70))

  // Get tokens for each client
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')

  const clientTokens = {}
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientTokens[c.id] = { token, name: c.company_name }
    }
  }
  console.log('Clients with tokens:', Object.keys(clientTokens).length)

  // Get shipments from different time periods WITHOUT event data
  console.log('\nFetching sample shipments from different time periods...')

  const periods = [
    { label: 'Last 3 days', days: 3 },
    { label: '7 days ago', days: 7 },
    { label: '14 days ago', days: 14 },
    { label: '30 days ago', days: 30 },
    { label: '60 days ago', days: 60 },
    { label: '90 days ago', days: 90 },
    { label: '180 days ago', days: 180 },
  ]

  for (const period of periods) {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - period.days - 7)
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - period.days)

    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, client_id, status, created_at')
      .is('event_intransit', null)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .eq('status', 'Completed')
      .limit(2)

    console.log('\n' + '='.repeat(50))
    console.log(period.label + ' (status=Completed, no event_intransit):')

    if (!shipments || shipments.length === 0) {
      console.log('  No shipments found in this period')
      continue
    }

    for (const ship of shipments) {
      const clientInfo = clientTokens[ship.client_id]
      if (!clientInfo) {
        console.log('  No token for client', ship.client_id)
        continue
      }

      console.log('\n  Shipment:', ship.shipment_id, '| Created:', ship.created_at?.substring(0, 10))
      console.log('  Client:', clientInfo.name)

      // Test Timeline API
      const timelineRes = await fetch(
        'https://api.shipbob.com/2025-07/shipment/' + ship.shipment_id + '/timeline',
        { headers: { Authorization: 'Bearer ' + clientInfo.token } }
      )

      console.log('  Timeline API Status:', timelineRes.status)

      if (timelineRes.ok) {
        const timeline = await timelineRes.json()
        console.log('  Timeline events:', timeline.length)
        if (timeline.length > 0) {
          const eventTypes = timeline.map(e => e.log_type_id + ':' + e.log_type_name)
          console.log('    Events:', eventTypes.join(', '))
          // Check if 607 (InTransit) exists
          const hasInTransit = timeline.some(e => e.log_type_id === 607)
          console.log('    Has InTransit (607):', hasInTransit)
        }
      } else {
        const errText = await timelineRes.text()
        console.log('  Timeline Error:', errText.substring(0, 200))
      }

      // Test Logs API
      if (ship.shipbob_order_id) {
        const logsRes = await fetch(
          'https://api.shipbob.com/2025-07/order/' + ship.shipbob_order_id + '/shipment/' + ship.shipment_id + '/logs',
          { headers: { Authorization: 'Bearer ' + clientInfo.token } }
        )

        console.log('  Logs API Status:', logsRes.status)

        if (logsRes.ok) {
          const logs = await logsRes.json()
          console.log('  Log entries:', logs.length)
        } else {
          const errText = await logsRes.text()
          console.log('  Logs Error:', errText.substring(0, 200))
        }
      } else {
        console.log('  No shipbob_order_id - cannot call Logs API')
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100))
    }
  }

  // Also check: are there shipments WITH event_intransit that are older?
  console.log('\n\n' + '='.repeat(70))
  console.log('CHECKING: OLDEST SHIPMENTS WITH event_intransit')
  console.log('='.repeat(70))

  const { data: oldestWithData } = await supabase
    .from('shipments')
    .select('shipment_id, created_at, event_intransit, status')
    .not('event_intransit', 'is', null)
    .order('created_at', { ascending: true })
    .limit(5)

  console.log('\nOldest shipments with event_intransit:')
  for (const s of oldestWithData || []) {
    console.log('  ' + s.shipment_id + ': created=' + s.created_at?.substring(0, 10) +
                ' intransit=' + s.event_intransit?.substring(0, 10) + ' status=' + s.status)
  }

  // Check if the backfill script is even running correctly
  console.log('\n\n' + '='.repeat(70))
  console.log('BACKFILL SCRIPT SANITY CHECK')
  console.log('='.repeat(70))

  // Count by various criteria
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })

  const { count: noEventIntransit } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)

  const { count: noEventLogs } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_logs', null)

  const { count: hasAnyEventColumn } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .or('event_created.not.is.null,event_picked.not.is.null,event_packed.not.is.null,event_labeled.not.is.null,event_intransit.not.is.null')

  const { count: noShipbobOrderId } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('shipbob_order_id', null)

  console.log('\nTotal shipments:', totalShipments)
  console.log('Without event_intransit:', noEventIntransit, '(' + Math.round((totalShipments - noEventIntransit) / totalShipments * 100) + '% have it)')
  console.log('Without event_logs:', noEventLogs, '(' + Math.round((totalShipments - noEventLogs) / totalShipments * 100) + '% have it)')
  console.log('With ANY event column:', hasAnyEventColumn, '(' + Math.round(hasAnyEventColumn / totalShipments * 100) + '%)')
  console.log('Without shipbob_order_id:', noShipbobOrderId, '(needed for Logs API)')
}

main().catch(console.error)
