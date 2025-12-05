#!/usr/bin/env node
/**
 * Explore ALL possible ShipBob API endpoints
 * Looking for reporting/export/detailed billing endpoints
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function tryEndpoint(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
    },
  }
  if (body) options.body = JSON.stringify(body)

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, options)
    return { status: response.status, ok: response.ok }
  } catch (e) {
    return { status: 'error', ok: false }
  }
}

async function main() {
  console.log('═'.repeat(100))
  console.log('EXPLORING ALL POSSIBLE API ENDPOINTS')
  console.log('═'.repeat(100))

  // Potential endpoints to try
  const endpointsToTry = [
    // Billing/Financial
    '/2025-07/billing',
    '/2025-07/billing/report',
    '/2025-07/billing/export',
    '/2025-07/billing/detail',
    '/2025-07/billing/breakdown',
    '/2025-07/charges',
    '/2025-07/charges/breakdown',
    '/2025-07/costs',
    '/2025-07/shipping-costs',
    '/2025-07/fulfillment-costs',
    '/2025-07/surcharges',

    // Reports
    '/2025-07/reports',
    '/2025-07/report',
    '/2025-07/reporting',
    '/2025-07/analytics',
    '/2025-07/export',
    '/2025-07/exports',

    // Rates
    '/2025-07/rates',
    '/2025-07/rate-card',
    '/2025-07/shipping-rates',
    '/2025-07/carrier-rates',
    '/2025-07/quotes',
    '/2025-07/quote',

    // Detailed shipment info
    '/2025-07/shipment-charges',
    '/2025-07/shipment-costs',
    '/2025-07/shipment-billing',
    '/2025-07/fulfillment',
    '/2025-07/fulfillment-detail',

    // 1.0 API versions
    '/1.0/billing',
    '/1.0/billing/transactions',
    '/1.0/billing/charges',
    '/1.0/reports',
    '/1.0/rates',
    '/1.0/shipment/charges',

    // Admin/Account
    '/2025-07/account',
    '/2025-07/account/billing',
    '/2025-07/settings',
    '/2025-07/merchant',
    '/2025-07/merchant/billing',
  ]

  console.log(`\nTrying ${endpointsToTry.length} endpoints...\n`)

  const results = { found: [], notFound: [] }

  for (const endpoint of endpointsToTry) {
    const result = await tryEndpoint(endpoint)
    const status = `${endpoint}: ${result.status}`

    if (result.ok || result.status === 200) {
      results.found.push(endpoint)
      console.log(`✅ ${status}`)
    } else if (result.status === 404) {
      results.notFound.push(endpoint)
      // console.log(`   ${status}`)
    } else {
      console.log(`⚠️  ${status}`)
    }
  }

  console.log('\n' + '═'.repeat(100))
  console.log('RESULTS')
  console.log('═'.repeat(100))

  console.log(`\n✅ Found ${results.found.length} endpoints:`)
  for (const ep of results.found) {
    console.log(`  ${ep}`)
  }

  console.log(`\n❌ Not found: ${results.notFound.length}`)

  // Now let's explore the found endpoints
  if (results.found.length > 0) {
    console.log('\n' + '█'.repeat(80))
    console.log('EXPLORING FOUND ENDPOINTS')
    console.log('█'.repeat(80))

    for (const endpoint of results.found) {
      console.log(`\n--- ${endpoint} ---`)
      const response = await fetch(`${BASE_URL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json()
        console.log(JSON.stringify(data, null, 2).slice(0, 2000))
      }
    }
  }

  // Also check what the base billing endpoints return
  console.log('\n' + '█'.repeat(80))
  console.log('CHECKING BASE PATHS')
  console.log('█'.repeat(80))

  const basePaths = [
    '/2025-07',
    '/1.0',
  ]

  for (const path of basePaths) {
    console.log(`\n--- ${path} ---`)
    const result = await tryEndpoint(path)
    console.log(`Status: ${result.status}`)
  }

  // Check if there's an OpenAPI/Swagger endpoint
  console.log('\n' + '█'.repeat(80))
  console.log('CHECKING FOR API DOCUMENTATION ENDPOINTS')
  console.log('█'.repeat(80))

  const docEndpoints = [
    '/swagger',
    '/swagger.json',
    '/openapi',
    '/openapi.json',
    '/api-docs',
    '/docs',
  ]

  for (const endpoint of docEndpoints) {
    const result = await tryEndpoint(endpoint)
    console.log(`${endpoint}: ${result.status}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
