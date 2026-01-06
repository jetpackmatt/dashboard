/**
 * Investigate missing Dec 28 transactions
 *
 * Check if they appear in ANY SFTP file (including earlier dates)
 */

require('dotenv').config({ path: '.env.local' })
const Client = require('ssh2-sftp-client')
const { parse } = require('csv-parse/sync')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function investigate() {
  console.log('='.repeat(70))
  console.log('Investigating missing Dec 28 transactions')
  console.log('='.repeat(70))
  console.log('')

  // First get the Dec 28 shipment IDs from DB
  const { data: dec28Tx, error: dbError } = await supabase
    .from('transactions')
    .select('reference_id, charge_date, cost')
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .eq('charge_date', '2025-12-28')
    .limit(500)

  if (dbError) {
    console.error('DB error:', dbError)
    return
  }

  console.log('Dec 28 transactions in DB: ' + dec28Tx.length)
  const dec28Ids = new Set(dec28Tx.map(t => t.reference_id))
  console.log('')

  // Now check ALL SFTP files
  const sftp = new Client()
  const config = {
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD,
    remotePath: process.env.SFTP_REMOTE_PATH || '/'
  }

  await sftp.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password
  })

  console.log('Connected to SFTP server')

  // List all files
  const files = await sftp.list(config.remotePath)
  const dailyFiles = files
    .filter(f => f.name.startsWith('JetPack_Shipment_Extras_') && f.name.endsWith('.csv'))
    .map(f => f.name)
    .sort()

  console.log('Checking ' + dailyFiles.length + ' SFTP files...')
  console.log('')

  // Track which files contain the Dec 28 IDs
  const foundInFile = new Map() // shipment_id -> [filenames]

  for (const filename of dailyFiles) {
    const remotePath = config.remotePath + '/' + filename

    try {
      const buffer = await sftp.get(remotePath)
      const csvContent = buffer.toString('utf-8')

      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      })

      const shipmentIds = new Set()
      for (const row of records) {
        const sid = String(row['Shipment ID'] || '')
        if (sid) {
          shipmentIds.add(sid)
        }
      }

      // Check if any Dec 28 IDs are in this file
      let foundCount = 0
      for (const sid of dec28Ids) {
        if (shipmentIds.has(sid)) {
          foundCount++
          if (!foundInFile.has(sid)) {
            foundInFile.set(sid, [])
          }
          foundInFile.get(sid).push(filename)
        }
      }

      console.log('  ' + filename + ': ' + shipmentIds.size + ' unique shipments, ' + foundCount + ' of Dec 28 txns found')
    } catch (err) {
      console.log('  ' + filename + ': Error - ' + err.message)
    }
  }

  await sftp.end()

  console.log('')
  console.log('='.repeat(70))
  console.log('RESULTS')
  console.log('='.repeat(70))
  console.log('Dec 28 transactions in DB: ' + dec28Tx.length)
  console.log('Found in ANY SFTP file: ' + foundInFile.size)
  console.log('Still missing from ALL SFTP files: ' + (dec28Tx.length - foundInFile.size))
  console.log('')

  // Show which files contain Dec 28 transactions
  const fileHitCounts = {}
  for (const [sid, files] of foundInFile) {
    for (const f of files) {
      fileHitCounts[f] = (fileHitCounts[f] || 0) + 1
    }
  }

  console.log('Dec 28 transactions by SFTP file:')
  console.log('-'.repeat(70))
  for (const [file, count] of Object.entries(fileHitCounts).sort()) {
    console.log('  ' + file + ': ' + count + ' transactions')
  }
  console.log('')

  // Show sample of truly missing
  const trulyMissing = dec28Tx.filter(t => !foundInFile.has(t.reference_id))
  if (trulyMissing.length > 0) {
    console.log('Sample of truly missing shipments (first 10):')
    console.log('-'.repeat(70))
    for (const tx of trulyMissing.slice(0, 10)) {
      console.log('  ' + tx.reference_id + ' - cost: $' + tx.cost)
    }
  }
}

investigate().catch(console.error)
