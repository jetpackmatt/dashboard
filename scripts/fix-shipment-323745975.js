#!/usr/bin/env node
/**
 * Fix shipment 323745975:
 * 1. Populate base_cost for the valid transaction (on invoice 8661966)
 * 2. Optionally remove the orphan duplicate (invoice_id = NULL)
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

// From SFTP file: shipment 323745975 has base_cost $3.95, surcharge $0.00
const SFTP_DATA = {
  shipment_id: '323745975',
  invoice_id_sb: 8661966,
  base_cost: 3.95,
  surcharge: 0.00,
  insurance_cost: 0.00
}

async function main() {
  console.log('='.repeat(80))
  console.log('FIX: Shipment 323745975 base_cost')
  console.log('='.repeat(80))

  // 1. Update the valid transaction (on invoice 8661966)
  console.log('\n1. Updating valid transaction on invoice 8661966...')

  const { data: updated, error: updateError } = await supabase
    .from('transactions')
    .update({
      base_cost: SFTP_DATA.base_cost,
      surcharge: SFTP_DATA.surcharge,
      insurance_cost: SFTP_DATA.insurance_cost
    })
    .eq('reference_id', SFTP_DATA.shipment_id)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .eq('invoice_id_sb', SFTP_DATA.invoice_id_sb)
    .select('id, reference_id, cost, base_cost, surcharge')
    .single()

  if (updateError) {
    console.log('   ERROR:', updateError.message)
  } else {
    console.log('   SUCCESS! Updated transaction:', updated.id)
    console.log(`   base_cost: $${updated.base_cost}, surcharge: $${updated.surcharge}`)
  }

  // 2. Check the orphan transaction
  console.log('\n2. Checking orphan transaction (invoice_id = NULL)...')

  const { data: orphan } = await supabase
    .from('transactions')
    .select('id, transaction_id, invoice_id_sb, cost, created_at')
    .eq('reference_id', SFTP_DATA.shipment_id)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .is('invoice_id_sb', null)
    .single()

  if (orphan) {
    console.log('   Found orphan transaction:')
    console.log(`     ID: ${orphan.id}`)
    console.log(`     Transaction ID: ${orphan.transaction_id}`)
    console.log(`     Cost: $${orphan.cost}`)
    console.log(`     Created: ${orphan.created_at}`)
    console.log('\n   NOTE: This orphan should be investigated - it may be a duplicate')
    console.log('   from an earlier sync. Not deleting automatically.')
  } else {
    console.log('   No orphan found (already cleaned up)')
  }

  // 3. Verify the fix
  console.log('\n3. Verifying fix...')

  const { data: txs } = await supabase
    .from('transactions')
    .select('id, transaction_id, invoice_id_sb, cost, base_cost, surcharge')
    .eq('reference_id', SFTP_DATA.shipment_id)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')

  console.log(`   Found ${txs?.length} transactions for shipment ${SFTP_DATA.shipment_id}:`)
  for (const tx of txs || []) {
    const hasBreakdown = tx.base_cost !== null ? '✓' : '✗'
    console.log(`     ${hasBreakdown} Invoice ${tx.invoice_id_sb || 'NULL'}: $${tx.cost} (base: $${tx.base_cost ?? 'NULL'}, surcharge: $${tx.surcharge ?? 'NULL'})`)
  }
}

main().catch(console.error)
