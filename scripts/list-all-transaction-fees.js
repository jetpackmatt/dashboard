#!/usr/bin/env node
/**
 * Get the full list of transaction fees from ShipBob API
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function main() {
  console.log('═'.repeat(80))
  console.log('ALL SHIPBOB TRANSACTION FEE TYPES')
  console.log('═'.repeat(80))

  const response = await fetch(`${BASE_URL}/2025-07/transaction-fees`, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
    },
  })

  const data = await response.json()
  const feeList = data.fee_list || []

  console.log(`\nTotal fee types: ${feeList.length}\n`)

  // Display numbered list
  feeList.forEach((fee, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${fee}`)
  })

  console.log('\n' + '═'.repeat(80))
  console.log('Fees that MIGHT be surcharges (containing keywords):')
  console.log('═'.repeat(80))

  const surchargeKeywords = ['surcharge', 'correction', 'additional', 'adjustment', 'peak', 'fuel', 'residential', 'delivery area', 'oversize', 'dim']

  for (const fee of feeList) {
    const lower = fee.toLowerCase()
    for (const keyword of surchargeKeywords) {
      if (lower.includes(keyword)) {
        console.log(`  - ${fee}`)
        break
      }
    }
  }
}

main().catch(console.error)
