/**
 * Validate SFTP Daily Coverage
 *
 * Compares shipment IDs in the new daily SFTP format against shipping transactions in DB.
 * Checks multiple days to catch timezone edge cases.
 *
 * Usage: node scripts/validate-sftp-coverage.js [startDate] [endDate]
 * Example: node scripts/validate-sftp-coverage.js 2025-12-22 2025-12-28
 */

require('dotenv').config({ path: '.env.local' })
const Client = require('ssh2-sftp-client')
const { parse } = require('csv-parse/sync')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// SFTP config
function getConfig() {
  return {
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD,
    remotePath: process.env.SFTP_REMOTE_PATH || '/'
  }
}

// Format date as YYYY-MM-DD for new daily filename
function formatDateForDailyFilename(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Parse a single daily SFTP file
async function fetchDailyFile(sftp, config, date) {
  const dateStr = formatDateForDailyFilename(date)
  const filename = `JetPack_Shipment_Extras_${dateStr}.csv`
  const remotePath = `${config.remotePath}/${filename}`

  try {
    const exists = await sftp.exists(remotePath)
    if (!exists) {
      return { success: false, filename, rows: [], error: 'File not found' }
    }

    const buffer = await sftp.get(remotePath)
    const csvContent = buffer.toString('utf-8')

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    })

    // Parse rows from new format
    const rows = records.map(row => ({
      user_id: String(row['User ID'] || ''),
      merchant_name: String(row['Merchant Name'] || ''),
      shipment_id: String(row['Shipment ID'] || ''),
      fee_type: String(row['Fee_Type'] || row['Fee Type'] || ''),
      fee_amount: parseFloat(String(row['Fee Amount'] || row['Fee_Amount'] || '0').replace(/[$,]/g, '')) || 0
    }))

    return { success: true, filename, rows, date: dateStr }
  } catch (error) {
    return { success: false, filename, rows: [], error: error.message }
  }
}

// Group SFTP rows by shipment_id and aggregate
function aggregateSftpData(allRows) {
  const byShipment = new Map()

  for (const row of allRows) {
    if (!row.shipment_id) continue

    if (!byShipment.has(row.shipment_id)) {
      byShipment.set(row.shipment_id, {
        shipment_id: row.shipment_id,
        merchant_name: row.merchant_name,
        base_cost: 0,
        surcharges: [],
        insurance_cost: 0,
        total: 0,
        source_dates: new Set()
      })
    }

    const agg = byShipment.get(row.shipment_id)
    agg.source_dates.add(row.source_date)

    const feeType = row.fee_type.toLowerCase()

    if (feeType === 'base rate') {
      agg.base_cost += row.fee_amount
    } else if (feeType.includes('insurance')) {
      agg.insurance_cost += row.fee_amount
    } else {
      // It's a surcharge
      agg.surcharges.push({ type: row.fee_type, amount: row.fee_amount })
    }

    agg.total += row.fee_amount
  }

  return byShipment
}

// Main validation
async function validateCoverage(startDate, endDate) {
  console.log('='.repeat(70))
  console.log('SFTP Daily Coverage Validation')
  console.log('='.repeat(70))
  console.log(`DB charge_date range: ${formatDateForDailyFilename(startDate)} to ${formatDateForDailyFilename(endDate)}`)

  // IMPORTANT: SFTP files appear 1 day AFTER charge_date
  // So for DB range Dec 22-28, we need SFTP files Dec 23-29
  const sftpStartDate = new Date(startDate)
  sftpStartDate.setDate(sftpStartDate.getDate() + 1)
  const sftpEndDate = new Date(endDate)
  sftpEndDate.setDate(sftpEndDate.getDate() + 1)

  console.log(`SFTP file date range: ${formatDateForDailyFilename(sftpStartDate)} to ${formatDateForDailyFilename(sftpEndDate)}`)
  console.log('(SFTP files appear 1 day after charge_date)')
  console.log('')

  const sftp = new Client()
  const config = getConfig()

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password
    })

    console.log('Connected to SFTP server')
    console.log('')

    // List all available daily files
    const files = await sftp.list(config.remotePath)
    const dailyFiles = files
      .filter(f => f.name.startsWith('JetPack_Shipment_Extras_') && f.name.endsWith('.csv'))
      .map(f => f.name)
      .sort()

    console.log(`Found ${dailyFiles.length} daily files on SFTP:`)
    dailyFiles.forEach(f => console.log(`  ${f}`))
    console.log('')

    // Fetch all files in SFTP date range (+1 day offset)
    const allSftpRows = []
    const fileStats = []

    const currentDate = new Date(sftpStartDate)
    while (currentDate <= sftpEndDate) {
      const result = await fetchDailyFile(sftp, config, currentDate)

      fileStats.push({
        date: formatDateForDailyFilename(currentDate),
        filename: result.filename,
        success: result.success,
        rowCount: result.rows.length,
        error: result.error
      })

      if (result.success) {
        // Add source date to each row
        for (const row of result.rows) {
          row.source_date = formatDateForDailyFilename(currentDate)
          allSftpRows.push(row)
        }
      }

      currentDate.setDate(currentDate.getDate() + 1)
    }

    await sftp.end()

    // Print file stats
    console.log('File fetch results:')
    console.log('-'.repeat(70))
    for (const stat of fileStats) {
      const status = stat.success ? `✓ ${stat.rowCount} rows` : `✗ ${stat.error}`
      console.log(`  ${stat.date}: ${status}`)
    }
    console.log('')

    // Aggregate SFTP data
    const sftpByShipment = aggregateSftpData(allSftpRows)
    console.log(`Total unique shipments in SFTP files: ${sftpByShipment.size}`)
    console.log('')

    // Print fee type distribution
    const feeTypeCounts = new Map()
    for (const row of allSftpRows) {
      const count = feeTypeCounts.get(row.fee_type) || 0
      feeTypeCounts.set(row.fee_type, count + 1)
    }

    console.log('Fee types found in SFTP:')
    console.log('-'.repeat(70))
    const sortedFeeTypes = [...feeTypeCounts.entries()].sort((a, b) => b[1] - a[1])
    for (const [feeType, count] of sortedFeeTypes) {
      console.log(`  ${feeType}: ${count} rows`)
    }
    console.log('')

    // Fetch DB transactions for the date range (with pagination to avoid 1000 limit)
    console.log('Fetching shipping transactions from DB...')

    const startDateStr = formatDateForDailyFilename(startDate)
    const endDateStr = formatDateForDailyFilename(endDate)

    const dbTransactions = []
    const PAGE_SIZE = 1000
    let lastId = null

    while (true) {
      let query = supabase
        .from('transactions')
        .select('id, reference_id, charge_date, cost, base_cost, surcharge, client_id')
        .eq('reference_type', 'Shipment')
        .eq('fee_type', 'Shipping')
        .gte('charge_date', startDateStr)
        .lte('charge_date', endDateStr)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)

      if (lastId) {
        query = query.gt('id', lastId)
      }

      const { data, error: dbError } = await query

      if (dbError) {
        console.error('DB error:', dbError)
        return
      }

      if (!data || data.length === 0) break

      dbTransactions.push(...data)
      lastId = data[data.length - 1].id

      if (data.length < PAGE_SIZE) break
    }

    console.log(`Found ${dbTransactions.length} shipping transactions in DB for date range`)
    console.log('')

    // Build DB lookup
    const dbByShipment = new Map()
    for (const tx of dbTransactions) {
      dbByShipment.set(tx.reference_id, tx)
    }

    // Compare
    const matched = []
    const inSftpOnly = []
    const inDbOnly = []

    // Check SFTP against DB
    for (const [shipmentId, sftpData] of sftpByShipment) {
      if (dbByShipment.has(shipmentId)) {
        matched.push({
          shipment_id: shipmentId,
          sftp: sftpData,
          db: dbByShipment.get(shipmentId)
        })
      } else {
        inSftpOnly.push(sftpData)
      }
    }

    // Check DB against SFTP
    for (const [shipmentId, dbData] of dbByShipment) {
      if (!sftpByShipment.has(shipmentId)) {
        inDbOnly.push(dbData)
      }
    }

    // Results
    console.log('='.repeat(70))
    console.log('COVERAGE RESULTS')
    console.log('='.repeat(70))
    console.log(`Matched (in both):     ${matched.length}`)
    console.log(`In SFTP only:          ${inSftpOnly.length}`)
    console.log(`In DB only:            ${inDbOnly.length}`)
    console.log('')

    // Show SFTP-only samples (likely not synced to DB yet)
    if (inSftpOnly.length > 0) {
      console.log('Sample shipments in SFTP but NOT in DB (first 10):')
      console.log('-'.repeat(70))
      for (const item of inSftpOnly.slice(0, 10)) {
        console.log(`  ${item.shipment_id} - ${item.merchant_name} - base: $${item.base_cost.toFixed(2)}, surcharges: ${item.surcharges.length}`)
      }
      console.log('')
    }

    // Show DB-only (CONCERNING - missing from SFTP)
    if (inDbOnly.length > 0) {
      console.log('⚠️  Shipments in DB but NOT in any SFTP file (first 20):')
      console.log('-'.repeat(70))
      for (const item of inDbOnly.slice(0, 20)) {
        console.log(`  ${item.reference_id} - charge_date: ${item.charge_date}, cost: $${item.cost}`)
      }
      console.log('')

      // Group by charge_date
      const byDate = {}
      for (const item of inDbOnly) {
        byDate[item.charge_date] = (byDate[item.charge_date] || 0) + 1
      }
      console.log('Missing by charge_date:')
      for (const [date, count] of Object.entries(byDate).sort()) {
        console.log(`  ${date}: ${count} missing`)
      }
      console.log('')
    }

    // Show matched sample with surcharge details
    console.log('Sample matched shipments (first 5 with surcharges):')
    console.log('-'.repeat(70))
    const withSurcharges = matched.filter(m => m.sftp.surcharges.length > 0).slice(0, 5)
    for (const item of withSurcharges) {
      console.log(`  ${item.shipment_id}:`)
      console.log(`    SFTP: base=$${item.sftp.base_cost.toFixed(2)}, surcharges=${JSON.stringify(item.sftp.surcharges)}`)
      console.log(`    DB:   cost=$${item.db.cost}, base_cost=${item.db.base_cost || 'null'}, surcharge=${item.db.surcharge || 'null'}`)
    }
    console.log('')

    // Coverage percentage
    const totalInDb = dbTransactions.length
    const matchedCount = matched.length
    const coveragePercent = totalInDb > 0 ? ((matchedCount / totalInDb) * 100).toFixed(2) : 0

    console.log('='.repeat(70))
    console.log(`COVERAGE: ${matchedCount}/${totalInDb} = ${coveragePercent}%`)
    console.log('='.repeat(70))

    if (inDbOnly.length === 0) {
      console.log('✅ All DB shipments found in SFTP files!')
    } else {
      console.log(`⚠️  ${inDbOnly.length} DB shipments missing from SFTP (check adjacent days)`)
    }

  } catch (error) {
    console.error('Error:', error)
    await sftp.end()
  }
}

// Parse command line args
const args = process.argv.slice(2)
let startDate, endDate

if (args.length >= 2) {
  startDate = new Date(args[0])
  endDate = new Date(args[1])
} else {
  // Default: last 7 days
  endDate = new Date()
  endDate.setDate(endDate.getDate() - 1) // Yesterday
  startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 6) // 7 days ago
}

validateCoverage(startDate, endDate)
