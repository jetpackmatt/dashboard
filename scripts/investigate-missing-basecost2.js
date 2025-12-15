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

const TX_ID = '0371a411-f8e3-4ec6-81df-c494c24f2eda'
const MISSING_SHIPMENT = '323745975'

async function main() {
  console.log('='.repeat(80))
  console.log('INVESTIGATING MISSING BASE_COST')
  console.log('='.repeat(80))

  // 1. Get the transaction directly by ID
  console.log('\n1. Getting transaction by ID...')
  const { data: tx } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', TX_ID)
    .single()

  if (!tx) {
    console.log('   ERROR: Transaction not found!')
    return
  }

  console.log(`   Transaction ID: ${tx.transaction_id}`)
  console.log(`   Reference ID: ${tx.reference_id}`)
  console.log(`   Reference Type: ${tx.reference_type}`)
  console.log(`   Fee Type: ${tx.fee_type}`)
  console.log(`   Tracking ID: ${tx.tracking_id}`)
  console.log(`   Base Cost: ${tx.base_cost}`)
  console.log(`   Surcharge: ${tx.surcharge}`)
  console.log(`   Cost (total): ${tx.cost}`)
  console.log(`   Invoice ID: ${tx.invoice_id_sb}`)

  // 2. Get the shipment details
  console.log('\n2. Getting shipment details...')
  const { data: shipment } = await supabase
    .from('shipments')
    .select('shipment_id, tracking_id, carrier, status')
    .eq('shipment_id', tx.reference_id)
    .single()

  if (shipment) {
    console.log(`   Shipment ID: ${shipment.shipment_id}`)
    console.log(`   Tracking ID: ${shipment.tracking_id}`)
    console.log(`   Carrier: ${shipment.carrier}`)
    console.log(`   Status: ${shipment.status}`)
  } else {
    console.log('   Shipment not found in shipments table')
  }

  // Get tracking from either source
  const trackingId = tx.tracking_id || shipment?.tracking_id

  // 3. Search SFTP file
  console.log('\n3. Searching SFTP file for tracking number:', trackingId)
  const sftpFile = '/Users/mattmcleod/Downloads/extras-120825 - Export.csv'

  if (!fs.existsSync(sftpFile)) {
    console.log(`   ERROR: SFTP file not found at ${sftpFile}`)
    return
  }

  const csvContent = fs.readFileSync(sftpFile, 'utf-8')
  const lines = csvContent.split('\n')
  const headerLine = lines[0]

  // Parse header
  const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, ''))
  console.log(`\n   File has ${lines.length} lines`)
  console.log(`   Columns: ${headers.join(' | ')}`)

  // Find tracking number column index
  const trackingColIdx = headers.findIndex(h => h.toLowerCase().includes('tracking'))
  console.log(`\n   Tracking column index: ${trackingColIdx} ("${headers[trackingColIdx]}")`)

  // Search for tracking number
  let foundLines = []
  for (let i = 1; i < lines.length; i++) {
    if (trackingId && lines[i].includes(trackingId)) {
      foundLines.push({ lineNum: i + 1, content: lines[i] })
    }
  }

  if (foundLines.length === 0) {
    console.log(`\n   ⚠️  NOT FOUND in SFTP file!`)
    console.log(`   The tracking number "${trackingId}" is NOT in the SFTP file.`)
    console.log(`   This is why base_cost wasn't populated.`)

    // Check if shipment is DHL - DHL might use different format
    if (shipment?.carrier === 'DHLExpress') {
      console.log(`\n   Note: This is a DHLExpress shipment.`)
      console.log(`   DHL tracking numbers may have different formats in ShipBob vs SFTP.`)

      // Show some DHL entries from the file
      console.log('\n   Sample DHL entries from SFTP file:')
      let dhlCount = 0
      for (let i = 1; i < lines.length && dhlCount < 5; i++) {
        if (lines[i].toLowerCase().includes('dhl')) {
          dhlCount++
          const vals = lines[i].split(',')
          console.log(`     ${vals[trackingColIdx] || 'N/A'}`)
        }
      }
    }
  } else {
    console.log(`\n   ✓ FOUND ${foundLines.length} matches:`)
    foundLines.forEach(f => {
      const values = f.content.split(',')
      console.log(`\n   Line ${f.lineNum}:`)
      headers.forEach((h, idx) => {
        if (values[idx]?.trim()) console.log(`     ${h}: ${values[idx].trim()}`)
      })
    })
  }

  // 4. Show how SFTP sync matches
  console.log('\n' + '='.repeat(80))
  console.log('4. Checking SFTP sync matching logic...')

  // Read the SFTP sync code
  const syncCodePath = path.resolve(__dirname, '../lib/shipbob/sftp-sync.ts')
  if (fs.existsSync(syncCodePath)) {
    console.log(`\n   SFTP sync code exists at: ${syncCodePath}`)
    console.log('   Please check how it matches SFTP rows to transactions.')
  }
}

main().catch(console.error)
