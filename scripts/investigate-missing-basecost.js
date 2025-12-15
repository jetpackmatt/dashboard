#!/usr/bin/env node
/**
 * Investigate why shipment 323745975 didn't get base_cost from SFTP sync
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

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
  console.log('INVESTIGATING MISSING BASE_COST FOR SHIPMENT', MISSING_SHIPMENT)
  console.log('='.repeat(80))

  // 1. Get the shipment details from shipments table
  console.log('\n1. Getting shipment details from shipments table...')
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('shipment_id', MISSING_SHIPMENT)
    .single()

  if (!shipment) {
    console.log('   ERROR: Shipment not found in shipments table!')
    return
  }

  console.log(`   Shipment ID: ${shipment.shipment_id}`)
  console.log(`   Tracking ID: ${shipment.tracking_id}`)
  console.log(`   Carrier: ${shipment.carrier}`)
  console.log(`   Status: ${shipment.status}`)
  console.log(`   Event Labeled: ${shipment.event_labeled}`)

  // 2. Get the transaction for this shipment
  console.log('\n2. Getting transaction for this shipment...')
  const { data: tx } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_id', MISSING_SHIPMENT)
    .eq('fee_type', 'Shipping')
    .single()

  if (!tx) {
    console.log('   ERROR: Transaction not found!')
    return
  }

  console.log(`   Transaction ID: ${tx.transaction_id}`)
  console.log(`   Tracking ID: ${tx.tracking_id}`)
  console.log(`   Base Cost: ${tx.base_cost}`)
  console.log(`   Surcharge: ${tx.surcharge}`)
  console.log(`   Cost (total): ${tx.cost}`)
  console.log(`   Invoice ID: ${tx.invoice_id_sb}`)

  // 3. Read the SFTP file and search for the tracking number
  console.log('\n3. Searching SFTP file for tracking number...')
  const sftpFile = '/Users/mattmcleod/Downloads/extras-120825 - Export.csv'

  if (!fs.existsSync(sftpFile)) {
    console.log(`   ERROR: SFTP file not found at ${sftpFile}`)
    return
  }

  const csvContent = fs.readFileSync(sftpFile, 'utf-8')
  const lines = csvContent.split('\n')
  const headerLine = lines[0]

  console.log(`   File has ${lines.length} lines`)
  console.log(`   Header: ${headerLine.substring(0, 200)}...`)

  // Parse header to understand column structure
  const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, ''))
  console.log(`\n   Columns: ${headers.join(', ')}`)

  // Search for the tracking number
  const trackingId = shipment.tracking_id || tx.tracking_id
  console.log(`\n   Searching for tracking number: ${trackingId}`)

  let foundLines = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes(trackingId)) {
      foundLines.push({ lineNum: i + 1, content: lines[i] })
    }
  }

  if (foundLines.length === 0) {
    console.log(`   NOT FOUND in SFTP file!`)

    // Try partial match
    const partialTracking = trackingId?.substring(0, 10)
    console.log(`\n   Trying partial match with: ${partialTracking}`)
    for (let i = 1; i < lines.length && foundLines.length < 5; i++) {
      if (lines[i].includes(partialTracking)) {
        foundLines.push({ lineNum: i + 1, content: lines[i] })
      }
    }

    if (foundLines.length > 0) {
      console.log(`   Found ${foundLines.length} partial matches:`)
      foundLines.forEach(f => console.log(`     Line ${f.lineNum}: ${f.content.substring(0, 200)}...`))
    }
  } else {
    console.log(`   FOUND ${foundLines.length} matches:`)
    foundLines.forEach(f => {
      console.log(`\n   Line ${f.lineNum}:`)
      const values = f.content.split(',')
      headers.forEach((h, idx) => {
        if (values[idx]) console.log(`     ${h}: ${values[idx]}`)
      })
    })
  }

  // 4. Check how many transactions HAVE base_cost for this invoice
  console.log('\n' + '='.repeat(80))
  console.log('4. Checking base_cost coverage for invoice 8661966...')

  const { data: invoiceTx } = await supabase
    .from('transactions')
    .select('base_cost, surcharge, tracking_id')
    .eq('invoice_id_sb', 8661966)
    .eq('fee_type', 'Shipping')
    .limit(3000)

  const withBaseCost = invoiceTx?.filter(t => t.base_cost !== null).length || 0
  const withoutBaseCost = invoiceTx?.filter(t => t.base_cost === null).length || 0

  console.log(`   Total shipping transactions: ${invoiceTx?.length || 0}`)
  console.log(`   With base_cost: ${withBaseCost}`)
  console.log(`   Without base_cost: ${withoutBaseCost}`)

  // Show samples without base_cost
  const samplesMissing = invoiceTx?.filter(t => t.base_cost === null).slice(0, 5)
  if (samplesMissing?.length > 0) {
    console.log('\n   Samples WITHOUT base_cost:')
    samplesMissing.forEach(t => console.log(`     - ${t.tracking_id}`))
  }
}

main().catch(console.error)
