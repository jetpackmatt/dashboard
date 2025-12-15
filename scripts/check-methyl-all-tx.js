#!/usr/bin/env node
/**
 * Check ALL Methyl-Life transactions regardless of invoice assignment
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

const METHYL_ID = 'a08be540-b912-4f74-a857-958b9f8e2cc5'

async function main() {
  console.log('CHECKING ALL METHYL-LIFE TRANSACTIONS')
  console.log('='.repeat(80))

  // Check total transaction count for Methyl-Life
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', METHYL_ID)

  console.log(`\nTotal Methyl-Life transactions in DB: ${totalCount}`)

  // Check by fee_type
  const { data: byFeeType } = await supabase
    .from('transactions')
    .select('fee_type, invoice_id_sb')
    .eq('client_id', METHYL_ID)
    .limit(1000)

  const feeCounts = {}
  const invoiceCounts = { assigned: 0, unassigned: 0 }
  byFeeType?.forEach(t => {
    feeCounts[t.fee_type] = (feeCounts[t.fee_type] || 0) + 1
    if (t.invoice_id_sb) {
      invoiceCounts.assigned++
    } else {
      invoiceCounts.unassigned++
    }
  })

  console.log('\nBy fee_type:')
  for (const [type, count] of Object.entries(feeCounts)) {
    console.log(`  - ${type}: ${count}`)
  }

  console.log('\nBy invoice assignment:')
  console.log(`  - With invoice_id_sb: ${invoiceCounts.assigned}`)
  console.log(`  - WITHOUT invoice_id_sb (NULL): ${invoiceCounts.unassigned}`)

  // Check recent transactions
  const { data: recent } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, charge_date, invoice_id_sb, reference_id, reference_type')
    .eq('client_id', METHYL_ID)
    .order('charge_date', { ascending: false })
    .limit(20)

  console.log('\n' + '='.repeat(80))
  console.log('Recent Methyl-Life transactions:')
  recent?.forEach(t => {
    console.log(`  ${t.charge_date} | ${t.fee_type} | ref: ${t.reference_id} (${t.reference_type}) | invoice: ${t.invoice_id_sb || 'NULL'}`)
  })

  // Check shipments
  console.log('\n' + '='.repeat(80))
  console.log('Methyl-Life shipments:')

  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', METHYL_ID)

  console.log(`  Total shipments: ${shipmentCount}`)

  const { data: recentShipments } = await supabase
    .from('shipments')
    .select('shipment_id, status, event_labeled, order_id')
    .eq('client_id', METHYL_ID)
    .order('event_labeled', { ascending: false })
    .limit(10)

  console.log('\n  Recent shipments:')
  recentShipments?.forEach(s => {
    console.log(`    ${s.shipment_id} | ${s.status} | labeled: ${s.event_labeled}`)
  })
}

main().catch(console.error)
