#!/usr/bin/env node
/**
 * Check duplicate transactions for shipment 323745975
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(80))
  console.log('CHECKING DUPLICATE TRANSACTIONS FOR SHIPMENT 323745975')
  console.log('='.repeat(80))

  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_id', '323745975')
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')

  console.log(`Found ${txs?.length} transactions:\n`)

  for (const tx of txs || []) {
    console.log(`Transaction: ${tx.transaction_id}`)
    console.log(`  ID:         ${tx.id}`)
    console.log(`  client_id:  ${tx.client_id}`)
    console.log(`  cost:       $${tx.cost}`)
    console.log(`  base_cost:  ${tx.base_cost ?? 'NULL'}`)
    console.log(`  surcharge:  ${tx.surcharge ?? 'NULL'}`)
    console.log(`  invoice_id: ${tx.invoice_id_sb}`)
    console.log(`  charge_date:${tx.charge_date}`)
    console.log(`  tracking_id:${tx.tracking_id}`)
    console.log(`  created_at: ${tx.created_at}`)
    console.log('')
  }

  // Check for other duplicate shipments
  console.log('='.repeat(80))
  console.log('CHECKING FOR OTHER DUPLICATE SHIPPING TRANSACTIONS...')
  console.log('='.repeat(80))

  const { data: allShipping } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', [8661966, 8661967, 8661968, 8661969])

  // Count duplicates
  const counts = new Map()
  for (const tx of allShipping || []) {
    const refId = tx.reference_id
    counts.set(refId, (counts.get(refId) || 0) + 1)
  }

  const duplicates = [...counts.entries()].filter(([, count]) => count > 1)
  console.log(`\nFound ${duplicates.length} shipments with duplicate transactions:`)
  for (const [refId, count] of duplicates) {
    console.log(`  - Shipment ${refId}: ${count} transactions`)
  }
}

main().catch(console.error)
