#!/usr/bin/env npx tsx
/**
 * Debug XLSX blank columns - test actual function
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { collectDetailedBillingDataByInvoiceIds } from '../lib/billing/invoice-generator'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

  // Get Henson client ID
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .ilike('company_name', '%henson%')
    .single()

  console.log('Client ID:', client!.id)
  console.log('Invoice IDs:', INVOICE_IDS)

  // Call actual function with fix
  console.log('\n=== Testing collectDetailedBillingDataByInvoiceIds ===')
  const detailedData = await collectDetailedBillingDataByInvoiceIds(client!.id, INVOICE_IDS)

  console.log('\nShipments:', detailedData.shipments?.length || 0)
  const shipments = detailedData.shipments || []
  const withCustomerName = shipments.filter(s => s.customer_name && s.customer_name.trim() !== '')
  const withStoreName = shipments.filter(s => s.store_integration_name && s.store_integration_name.trim() !== '')
  const withZipCode = shipments.filter(s => s.zip_code && s.zip_code.trim() !== '')

  console.log('With customer_name:', withCustomerName.length, `(${(withCustomerName.length/shipments.length*100).toFixed(1)}%)`)
  console.log('With store_integration_name:', withStoreName.length, `(${(withStoreName.length/shipments.length*100).toFixed(1)}%)`)
  console.log('With zip_code:', withZipCode.length, `(${(withZipCode.length/shipments.length*100).toFixed(1)}%)`)

  // Show samples
  console.log('\n=== Sample Shipments ===')
  for (const s of shipments.slice(0, 3)) {
    console.log('  shipment_id:', s.shipment_id)
    console.log('  customer_name:', s.customer_name)
    console.log('  store_integration_name:', s.store_integration_name)
    console.log('  zip_code:', s.zip_code)
    console.log('')
  }
}

main().catch(console.error)
