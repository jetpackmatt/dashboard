/**
 * Find the exact missing transaction between SFTP and DB
 */

require('dotenv').config({ path: '.env.local' })
const Client = require('ssh2-sftp-client')
const { parse } = require('csv-parse/sync')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function findMissing() {
  console.log('='.repeat(70))
  console.log('Finding exact missing transaction')
  console.log('='.repeat(70))
  console.log('')

  // Step 1: Get ALL DB transactions with pagination
  console.log('Fetching all DB transactions Dec 21-27...')
  const dbTransactions = []
  const PAGE_SIZE = 1000
  let lastId = null

  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, reference_id, charge_date, cost, client_id')
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .gte('charge_date', '2025-12-21')
      .lte('charge_date', '2025-12-27')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data, error } = await query

    if (error) {
      console.error('DB error:', error)
      return
    }

    if (!data || data.length === 0) break

    dbTransactions.push(...data)
    lastId = data[data.length - 1].id

    if (data.length < PAGE_SIZE) break
  }

  console.log('Total DB transactions:', dbTransactions.length)

  // Build lookup by shipment_id
  const dbByShipment = new Map()
  for (const tx of dbTransactions) {
    dbByShipment.set(tx.reference_id, tx)
  }
  console.log('Unique shipment IDs in DB:', dbByShipment.size)
  console.log('')

  // Step 2: Get all SFTP shipments for Dec 22-28 (next day files)
  console.log('Fetching SFTP files Dec 22-28...')

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

  const sftpShipmentIds = new Set()
  const dates = ['2025-12-22', '2025-12-23', '2025-12-24', '2025-12-25', '2025-12-26', '2025-12-27', '2025-12-28']

  for (const dateStr of dates) {
    const filename = `JetPack_Shipment_Extras_${dateStr}.csv`
    const remotePath = config.remotePath + '/' + filename

    try {
      const exists = await sftp.exists(remotePath)
      if (!exists) {
        console.log('  ' + dateStr + ': File not found')
        continue
      }

      const buffer = await sftp.get(remotePath)
      const csvContent = buffer.toString('utf-8')

      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      })

      let count = 0
      for (const row of records) {
        const sid = String(row['Shipment ID'] || '')
        if (sid && !sftpShipmentIds.has(sid)) {
          sftpShipmentIds.add(sid)
          count++
        }
      }

      console.log('  ' + dateStr + ': ' + count + ' unique shipments')
    } catch (err) {
      console.log('  ' + dateStr + ': Error - ' + err.message)
    }
  }

  await sftp.end()

  console.log('')
  console.log('Total unique shipments in SFTP:', sftpShipmentIds.size)
  console.log('')

  // Step 3: Find the missing one(s)
  const inDbNotSftp = []
  const inSftpNotDb = []

  for (const [shipmentId, tx] of dbByShipment) {
    if (!sftpShipmentIds.has(shipmentId)) {
      inDbNotSftp.push(tx)
    }
  }

  for (const shipmentId of sftpShipmentIds) {
    if (!dbByShipment.has(shipmentId)) {
      inSftpNotDb.push(shipmentId)
    }
  }

  console.log('='.repeat(70))
  console.log('RESULTS')
  console.log('='.repeat(70))
  console.log('DB shipments:', dbByShipment.size)
  console.log('SFTP shipments:', sftpShipmentIds.size)
  console.log('In DB but NOT in SFTP:', inDbNotSftp.length)
  console.log('In SFTP but NOT in DB:', inSftpNotDb.length)
  console.log('')

  if (inDbNotSftp.length > 0) {
    console.log('Transactions in DB missing from SFTP:')
    console.log('-'.repeat(70))
    for (const tx of inDbNotSftp) {
      console.log('  Shipment:', tx.reference_id)
      console.log('    charge_date:', tx.charge_date)
      console.log('    cost:', tx.cost)
      console.log('    client_id:', tx.client_id)

      // Look up shipment details
      const { data: shipment } = await supabase
        .from('shipments')
        .select('status, carrier, carrier_service, fc_name, order_type, created_date')
        .eq('shipment_id', tx.reference_id)
        .single()

      if (shipment) {
        console.log('    status:', shipment.status)
        console.log('    carrier:', shipment.carrier, '-', shipment.carrier_service)
        console.log('    fc_name:', shipment.fc_name)
        console.log('    order_type:', shipment.order_type)
        console.log('    created_date:', shipment.created_date)
      }
      console.log('')
    }
  }

  if (inSftpNotDb.length > 0) {
    console.log('Shipments in SFTP missing from DB:')
    console.log('-'.repeat(70))
    for (const sid of inSftpNotDb.slice(0, 10)) {
      console.log('  ' + sid)
    }
  }
}

findMissing().catch(console.error)
