#!/usr/bin/env node
/**
 * Check Shipments API for cost breakdown
 * Maybe fulfillment vs surcharge is in the shipment details, not billing
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const BASE_URL = 'https://api.shipbob.com'

// Get tokens from database
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function getClientToken(clientName) {
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name')
    .ilike('company_name', `%${clientName}%`)
    .single()

  if (!client) return null

  const { data: cred } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', client.id)
    .single()

  return cred?.api_token
}

async function fetchJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return response.ok ? await response.json() : null
}

function getAllKeys(obj, prefix = '') {
  const keys = new Set()
  if (!obj || typeof obj !== 'object') return keys

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    keys.add(fullKey)

    if (Array.isArray(value)) {
      keys.add(`${fullKey}[]`)
      if (value.length > 0 && typeof value[0] === 'object') {
        for (const k of getAllKeys(value[0], `${fullKey}[]`)) {
          keys.add(k)
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const k of getAllKeys(value, fullKey)) {
        keys.add(k)
      }
    }
  }
  return keys
}

async function main() {
  console.log('═'.repeat(100))
  console.log('CHECKING SHIPMENTS API FOR COST BREAKDOWN')
  console.log('═'.repeat(100))

  // Get Henson token (child token for shipments API)
  const hensonToken = await getClientToken('henson')
  const parentToken = process.env.SHIPBOB_API_TOKEN

  if (!hensonToken) {
    console.log('No Henson token found')
    return
  }

  console.log('Using Henson child token for Shipments API')

  // Test order with known breakdown from Excel
  // Order 320860433: Fulfillment=$5.97, Surcharge=$0.15, Total=$6.12
  const testOrderId = '320860433'

  // ═══════════════════════════════════════════════════════════════════════════
  // Try Shipments API with different endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '█'.repeat(80))
  console.log('SHIPMENTS API EXPLORATION')
  console.log('█'.repeat(80))

  // Try getting shipment by order ID
  console.log(`\nTrying to get shipment for order ${testOrderId}...`)

  // Try various endpoints
  const endpoints = [
    `/2025-07/shipment?orderId=${testOrderId}`,
    `/2025-07/shipment/${testOrderId}`,
    `/2025-07/order/${testOrderId}/shipments`,
    `/2025-07/order/${testOrderId}`,
  ]

  for (const endpoint of endpoints) {
    console.log(`\n--- ${endpoint} ---`)
    const result = await fetchJson(`${BASE_URL}${endpoint}`, hensonToken)

    if (result) {
      console.log('SUCCESS!')

      // If array, get first item
      const data = Array.isArray(result) ? result[0] : (result.items ? result.items[0] : result)

      if (data) {
        console.log('\nALL KEYS:')
        for (const key of [...getAllKeys(data)].sort()) {
          const hasBreakdown = key.toLowerCase().includes('cost') ||
                               key.toLowerCase().includes('rate') ||
                               key.toLowerCase().includes('surcharge') ||
                               key.toLowerCase().includes('charge') ||
                               key.toLowerCase().includes('fee') ||
                               key.toLowerCase().includes('price')
          console.log(`${hasBreakdown ? '>>> ' : '    '}${key}`)
        }

        console.log('\nFull response:')
        console.log(JSON.stringify(data, null, 2))
      }
    } else {
      console.log('No data')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Try getting recent shipments with all details
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('RECENT SHIPMENTS')
  console.log('█'.repeat(80))

  const recentShipments = await fetchJson(
    `${BASE_URL}/2025-07/shipment?LastUpdateStartDate=2025-11-27&PageSize=5`,
    hensonToken
  )

  if (recentShipments) {
    const shipments = Array.isArray(recentShipments) ? recentShipments : (recentShipments.items || [])
    console.log(`\nFound ${shipments.length} recent shipments`)

    if (shipments.length > 0) {
      console.log('\nFirst shipment ALL KEYS:')
      for (const key of [...getAllKeys(shipments[0])].sort()) {
        const hasBreakdown = key.toLowerCase().includes('cost') ||
                             key.toLowerCase().includes('rate') ||
                             key.toLowerCase().includes('surcharge') ||
                             key.toLowerCase().includes('charge') ||
                             key.toLowerCase().includes('fee') ||
                             key.toLowerCase().includes('amount') ||
                             key.toLowerCase().includes('price')
        console.log(`${hasBreakdown ? '>>> ' : '    '}${key}`)
      }

      console.log('\nFirst shipment full data:')
      console.log(JSON.stringify(shipments[0], null, 2))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Try Orders API
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('ORDERS API')
  console.log('█'.repeat(80))

  const order = await fetchJson(`${BASE_URL}/2025-07/order/${testOrderId}`, hensonToken)

  if (order) {
    console.log('\nOrder ALL KEYS:')
    for (const key of [...getAllKeys(order)].sort()) {
      const hasBreakdown = key.toLowerCase().includes('cost') ||
                           key.toLowerCase().includes('rate') ||
                           key.toLowerCase().includes('surcharge') ||
                           key.toLowerCase().includes('charge') ||
                           key.toLowerCase().includes('fee') ||
                           key.toLowerCase().includes('amount') ||
                           key.toLowerCase().includes('price')
      console.log(`${hasBreakdown ? '>>> ' : '    '}${key}`)
    }

    console.log('\nOrder full data:')
    console.log(JSON.stringify(order, null, 2))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Try Rates/Quotes API (if exists)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('CHECKING FOR RATES/QUOTES ENDPOINTS')
  console.log('█'.repeat(80))

  const rateEndpoints = [
    '/2025-07/rates',
    '/2025-07/quotes',
    '/2025-07/shipping-rates',
    '/1.0/rates',
    '/1.0/quotes',
  ]

  for (const endpoint of rateEndpoints) {
    const result = await fetchJson(`${BASE_URL}${endpoint}`, hensonToken)
    console.log(`${endpoint}: ${result ? 'EXISTS' : 'N/A'}`)
  }

  console.log('\n' + '═'.repeat(100))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
