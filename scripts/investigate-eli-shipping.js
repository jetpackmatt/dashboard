#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function investigate() {
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Get all Eli Health shipping transactions
  const { data: tx } = await supabase
    .from('transactions')
    .select('reference_id, cost, transaction_type')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)

  // Find duplicate reference_ids
  const byRef = {}
  for (const t of tx || []) {
    if (byRef[t.reference_id] === undefined) byRef[t.reference_id] = []
    byRef[t.reference_id].push(t)
  }

  const duplicates = Object.entries(byRef).filter(([_, arr]) => arr.length > 1)
  console.log('Unique shipment_ids:', Object.keys(byRef).length)
  console.log('Total transactions:', tx.length)
  console.log('Duplicate shipment_ids:', duplicates.length)

  console.log('\nDuplicate details:')
  for (const [refId, txs] of duplicates) {
    console.log('  Shipment', refId, ':')
    for (const t of txs) {
      console.log('    ', t.transaction_type, '$' + t.cost)
    }
  }
}

investigate().catch(console.error)
