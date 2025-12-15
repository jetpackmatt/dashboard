#!/usr/bin/env node
/**
 * Check client setup in the database
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhehiuanvcowiktcsmjr.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  console.log('CHECKING CLIENT SETUP')
  console.log('='.repeat(80))

  // List all clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, shipbob_channel_id, created_at')
    .order('name')

  console.log('\nAll clients:')
  clients?.forEach(c => {
    console.log(`  - ${c.name} | id: ${c.id} | shipbob_channel: ${c.shipbob_channel_id}`)
  })

  // Check API credentials
  console.log('\n' + '='.repeat(80))
  console.log('Client API Credentials:')

  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('client_id, provider, active, created_at')
    .eq('provider', 'shipbob')

  creds?.forEach(c => {
    const clientName = clients?.find(cl => cl.id === c.client_id)?.name || 'UNKNOWN'
    console.log(`  - ${clientName} (${c.client_id}) | active: ${c.active}`)
  })

  // Check if Methyl-Life exists by name search
  console.log('\n' + '='.repeat(80))
  console.log('Searching for "methyl" in clients:')

  const { data: methylSearch } = await supabase
    .from('clients')
    .select('id, name, shipbob_channel_id')
    .ilike('name', '%methyl%')

  console.log(`  Found: ${methylSearch?.length || 0}`)
  methylSearch?.forEach(c => {
    console.log(`    - ${c.name} | id: ${c.id} | channel: ${c.shipbob_channel_id}`)
  })

  // Check transaction counts by client
  console.log('\n' + '='.repeat(80))
  console.log('Transaction counts by client (top 10):')

  const { data: txCounts } = await supabase
    .rpc('exec_sql', {
      sql: `
        SELECT client_id, COUNT(*) as count
        FROM transactions
        GROUP BY client_id
        ORDER BY count DESC
        LIMIT 10
      `
    })

  // Since RPC might not exist, let's check manually
  for (const client of clients || []) {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)

    if (count && count > 0) {
      console.log(`  - ${client.name}: ${count} transactions`)
    }
  }

  // Check shipment counts by client
  console.log('\n' + '='.repeat(80))
  console.log('Shipment counts by client:')

  for (const client of clients || []) {
    const { count } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)

    if (count && count > 0) {
      console.log(`  - ${client.name}: ${count} shipments`)
    }
  }
}

main().catch(console.error)
