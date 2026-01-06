#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function check() {
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('=== ELI HEALTH ADDITIONAL SERVICES ===')
  // Get Additional Services transactions
  const { data: eliAdditional } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, cost, reference_type')
    .eq('client_id', eliHealthId)
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730397)  // AdditionalFee invoice
    .is('dispute_status', null)

  let eliAdditionalTotal = 0
  const eliByFeeType = {}
  for (const t of eliAdditional || []) {
    const ft = t.fee_type
    if (eliByFeeType[ft] === undefined) eliByFeeType[ft] = { count: 0, total: 0 }
    eliByFeeType[ft].count++
    eliByFeeType[ft].total += parseFloat(t.cost)
    eliAdditionalTotal += parseFloat(t.cost)
  }

  console.log('Count:', eliAdditional?.length)
  console.log('By fee_type:')
  for (const [ft, data] of Object.entries(eliByFeeType).sort((a, b) => b[1].total - a[1].total)) {
    console.log(' ', ft, ':', data.count, 'tx, $' + data.total.toFixed(2))
  }
  console.log('Total:', eliAdditionalTotal.toFixed(2), '(expected $394.56)')

  console.log('\n=== ELI HEALTH RECEIVING ===')
  const { data: eliReceiving } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, cost, taxes')
    .eq('client_id', eliHealthId)
    .in('reference_type', ['WRO', 'URO'])
    .eq('invoice_id_sb', 8730393)  // WarehouseInboundFee invoice
    .is('dispute_status', null)

  let eliReceivingTotal = 0
  let eliReceivingTaxTotal = 0
  for (const t of eliReceiving || []) {
    eliReceivingTotal += parseFloat(t.cost)
    if (t.taxes && t.taxes.length > 0) {
      for (const tax of t.taxes) {
        eliReceivingTaxTotal += parseFloat(tax.tax_amount || 0)
      }
    }
  }

  console.log('Count:', eliReceiving?.length)
  console.log('Cost total:', eliReceivingTotal.toFixed(2), '(expected $35)')
  console.log('Tax total:', eliReceivingTaxTotal.toFixed(2))
  console.log('Cost + Tax:', (eliReceivingTotal + eliReceivingTaxTotal).toFixed(2))

  console.log('\n=== HENSON ADDITIONAL SERVICES ===')
  const { data: hensonAdditional } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, cost, reference_type')
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  let hensonAdditionalTotal = 0
  const hensonByFeeType = {}
  for (const t of hensonAdditional || []) {
    const ft = t.fee_type
    if (hensonByFeeType[ft] === undefined) hensonByFeeType[ft] = { count: 0, total: 0 }
    hensonByFeeType[ft].count++
    hensonByFeeType[ft].total += parseFloat(t.cost)
    hensonAdditionalTotal += parseFloat(t.cost)
  }

  console.log('Count:', hensonAdditional?.length)
  console.log('By fee_type:')
  for (const [ft, data] of Object.entries(hensonByFeeType).sort((a, b) => b[1].total - a[1].total)) {
    console.log(' ', ft, ':', data.count, 'tx, $' + data.total.toFixed(2))
  }
  console.log('Total:', hensonAdditionalTotal.toFixed(2), '(expected $937.71)')

  console.log('\n=== HENSON STORAGE ===')
  const { data: hensonStorage } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, cost')
    .eq('client_id', hensonId)
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)
    .is('dispute_status', null)

  let hensonStorageTotal = 0
  for (const t of hensonStorage || []) {
    hensonStorageTotal += parseFloat(t.cost)
  }

  console.log('Count:', hensonStorage?.length)
  console.log('Total:', hensonStorageTotal.toFixed(2), '(expected $1089.73)')
}

check().catch(console.error)
