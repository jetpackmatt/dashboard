require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_api_credentials(api_token, provider)')
    .limit(1)

  const token = clients?.[0]?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
  if (!token) {
    console.log('No token found')
    return
  }

  // Check shipments for all event types
  const eventTypes = new Map()
  const { data: ships } = await supabase
    .from('shipments')
    .select('shipment_id, status')
    .eq('status', 'Completed')
    .limit(30)

  console.log('Checking', ships.length, 'shipments for timeline event types...\n')

  for (const ship of ships || []) {
    const res = await fetch(`https://api.shipbob.com/2025-07/shipment/${ship.shipment_id}/timeline`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      const timeline = await res.json()
      for (const e of timeline) {
        const existing = eventTypes.get(e.log_type_id) || {
          name: e.log_type_name,
          text: e.log_type_text,
          hasMetadata: false,
          sampleMetadata: null,
          allKeys: Object.keys(e)
        }

        // Check if metadata ever has content
        if (e.metadata !== null) {
          existing.hasMetadata = true
          existing.sampleMetadata = e.metadata
        }

        eventTypes.set(e.log_type_id, existing)
      }
    }
  }

  console.log('All timeline event types found:')
  console.log('='.repeat(100))
  console.log('ID   | Name                 | Text                 | Has Metadata | Object Keys')
  console.log('-'.repeat(100))

  for (const [id, info] of [...eventTypes.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      String(id).padEnd(5) + '| ' +
      info.name.padEnd(21) + '| ' +
      info.text.padEnd(21) + '| ' +
      String(info.hasMetadata).padEnd(13) + '| ' +
      info.allKeys.join(', ')
    )
    if (info.sampleMetadata) {
      console.log('      Sample metadata:', JSON.stringify(info.sampleMetadata))
    }
  }

  // Also check an Exception shipment to see if there are different events
  console.log('\n' + '='.repeat(100))
  console.log('Checking Exception shipments...')

  const { data: exceptionShips } = await supabase
    .from('shipments')
    .select('shipment_id, status')
    .eq('status', 'Exception')
    .limit(5)

  for (const ship of exceptionShips || []) {
    const res = await fetch(`https://api.shipbob.com/2025-07/shipment/${ship.shipment_id}/timeline`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      const timeline = await res.json()
      console.log(`\nException shipment ${ship.shipment_id}:`)
      for (const e of timeline) {
        console.log(`  ${e.log_type_id}: ${e.log_type_name} - ${e.timestamp}`)
        if (e.metadata) console.log(`     metadata:`, e.metadata)

        // Track new event types
        if (!eventTypes.has(e.log_type_id)) {
          eventTypes.set(e.log_type_id, {
            name: e.log_type_name,
            text: e.log_type_text,
            allKeys: Object.keys(e)
          })
          console.log(`     ^^^ NEW EVENT TYPE!`)
        }
      }
    }
  }

  console.log('\n' + '='.repeat(100))
  console.log('SUMMARY: All unique event types discovered:')
  for (const [id, info] of [...eventTypes.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${id}: ${info.name} ("${info.text}")`)
  }
}

main().catch(console.error)
