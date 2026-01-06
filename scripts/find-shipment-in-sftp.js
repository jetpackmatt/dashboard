#!/usr/bin/env node
/**
 * Find which SFTP files contain a specific shipment
 *
 * This searches all available daily SFTP files to find the shipment
 */

const { fetchDailyShippingBreakdown } = require('../lib/billing/sftp-client')
require('dotenv').config({ path: '.env.local' })

async function main() {
  const shipmentId = process.argv[2] || '330867617'

  console.log(`\n=== Searching for shipment ${shipmentId} in SFTP files ===\n`)

  // Check files from Dec 20 to Dec 29
  const fileDates = []
  for (let day = 20; day <= 29; day++) {
    fileDates.push(new Date(2025, 11, day)) // Dec 2025
  }

  const found = []

  for (const fileDate of fileDates) {
    const dateStr = `${fileDate.getFullYear()}-${String(fileDate.getMonth() + 1).padStart(2, '0')}-${String(fileDate.getDate()).padStart(2, '0')}`

    const result = await fetchDailyShippingBreakdown(fileDate)

    if (!result.success) {
      console.log(`${dateStr}: File not found`)
      continue
    }

    const match = result.rows.find(r => r.shipment_id === shipmentId)

    if (match) {
      console.log(`${dateStr}: ✓ FOUND - base_cost=$${match.base_cost}, surcharge=$${match.surcharge}, total=$${match.total}`)
      found.push({ date: dateStr, ...match })
    } else {
      console.log(`${dateStr}: ${result.rows.length} shipments, not found`)
    }
  }

  console.log(`\n--- Summary ---`)
  if (found.length === 0) {
    console.log(`Shipment ${shipmentId} not found in any SFTP file`)
  } else {
    console.log(`Found shipment ${shipmentId} in ${found.length} file(s):`)
    for (const f of found) {
      // Calculate expected charge_date (file date - 1)
      const [year, month, day] = f.date.split('-').map(Number)
      const chargeDate = new Date(year, month - 1, day)
      chargeDate.setDate(chargeDate.getDate() - 1)
      const chargeDateStr = `${chargeDate.getFullYear()}-${String(chargeDate.getMonth() + 1).padStart(2, '0')}-${String(chargeDate.getDate()).padStart(2, '0')}`

      console.log(`  File ${f.date} → charge_date ${chargeDateStr}: base=$${f.base_cost}, surcharge=$${f.surcharge}`)
    }
  }
}

main().catch(console.error)
