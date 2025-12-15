#!/usr/bin/env node
/**
 * Debug why shipment 323745975 wasn't matched in SFTP sync
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

const MISSING_SHIPMENT = '323745975'

async function main() {
  console.log('='.repeat(80))
  console.log('DEBUG: Why shipment', MISSING_SHIPMENT, 'wasnt matched in SFTP sync')
  console.log('='.repeat(80))

  // 1. Check the EXACT query the SFTP sync uses
  console.log('\n1. Running EXACT SFTP sync query...')
  const { data: exactMatch, error: exactError } = await supabase
    .from('transactions')
    .select('id, reference_id, reference_type, fee_type, base_cost, surcharge')
    .eq('reference_type', 'Shipment')
    .eq('reference_id', MISSING_SHIPMENT)
    .eq('fee_type', 'Shipping')
    .maybeSingle()

  console.log('   Query: reference_type=Shipment, reference_id=323745975, fee_type=Shipping')
  console.log('   Result:', exactMatch ? JSON.stringify(exactMatch, null, 2) : 'NULL')
  if (exactError) console.log('   Error:', exactError.message)

  // 2. Check with less strict conditions
  console.log('\n2. Checking with less strict conditions...')
  const { data: byRefId, error: refError } = await supabase
    .from('transactions')
    .select('id, reference_id, reference_type, fee_type, base_cost, surcharge')
    .eq('reference_id', MISSING_SHIPMENT)

  console.log('   Query: reference_id=323745975 only')
  console.log('   Result:', byRefId?.length || 0, 'rows')
  byRefId?.forEach(tx => {
    console.log(`     - id: ${tx.id}, ref_type: ${tx.reference_type}, fee_type: ${tx.fee_type}`)
  })

  // 3. Check total shipping transactions for Dec 8 invoices
  console.log('\n3. Checking Dec 8 invoice shipping transactions...')
  const invoiceIds = [8661966, 8661967, 8661968, 8661969]

  const { count: totalShipping } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', invoiceIds)

  const { count: withBaseCost } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .not('base_cost', 'is', null)

  console.log(`   Total shipping transactions: ${totalShipping}`)
  console.log(`   With base_cost populated: ${withBaseCost}`)
  console.log(`   Missing base_cost: ${(totalShipping || 0) - (withBaseCost || 0)}`)

  // 4. Get all transactions missing base_cost
  console.log('\n4. All transactions missing base_cost on Dec 8 invoices...')
  const { data: missingBaseCost } = await supabase
    .from('transactions')
    .select('id, reference_id, fee_type, cost, invoice_id_sb')
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('base_cost', null)
    .limit(20)

  console.log(`   Found ${missingBaseCost?.length || 0} transactions:`)
  missingBaseCost?.forEach(tx => {
    console.log(`     - Shipment ${tx.reference_id}, cost $${tx.cost}, invoice ${tx.invoice_id_sb}`)
  })
}

main().catch(console.error)
