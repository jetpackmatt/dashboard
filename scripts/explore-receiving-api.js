#!/usr/bin/env node
/**
 * Explore ShipBob Receiving/WRO API
 * 
 * WRO = Warehouse Receiving Order
 * Goal: Understand how to link WRO IDs to clients for Receiving transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const token = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  
  // Log response info
  console.log(`  Status: ${response.status} ${response.statusText}`)
  
  if (!response.ok) {
    const text = await response.text()
    console.log(`  Error body: ${text.slice(0, 500)}`)
    return null
  }
  
  return response.json()
}

async function main() {
  console.log('='.repeat(100))
  console.log('SHIPBOB RECEIVING/WRO API EXPLORATION')
  console.log('='.repeat(100))

  // Known WRO IDs from transactions
  const wroIds = ['869656', '869299']
  
  // ============================================================
  // PART 1: List all Receiving/WRO endpoints
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 1: EXPLORE RECEIVING API ENDPOINTS')
  console.log('█'.repeat(100))

  // Try different endpoint patterns
  const endpoints = [
    '/receiving',
    '/receiving-orders',
    '/warehouse-receiving-orders',
    '/wro',
    '/inbound',
    '/inbound-orders',
  ]

  console.log('\nTrying potential receiving endpoints...')
  for (const endpoint of endpoints) {
    console.log(`\n${API_BASE}${endpoint}:`)
    const data = await fetchJson(`${API_BASE}${endpoint}?Limit=5`)
    if (data) {
      console.log(`  ✅ Endpoint exists!`)
      console.log(`  Response keys: ${Object.keys(data).join(', ')}`)
      if (data.items?.length > 0) {
        console.log(`  First item keys: ${Object.keys(data.items[0]).join(', ')}`)
      }
    }
  }

  // ============================================================
  // PART 2: Try to look up specific WRO by ID
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 2: LOOK UP SPECIFIC WRO BY ID')
  console.log('█'.repeat(100))

  for (const wroId of wroIds) {
    console.log(`\n--- WRO ID: ${wroId} ---`)
    
    // Try different lookup patterns
    const lookups = [
      `/receiving/${wroId}`,
      `/receiving-orders/${wroId}`,
      `/warehouse-receiving-orders/${wroId}`,
      `/wro/${wroId}`,
    ]

    for (const path of lookups) {
      console.log(`\n${API_BASE}${path}:`)
      const data = await fetchJson(`${API_BASE}${path}`)
      if (data) {
        console.log(`  ✅ Found!`)
        console.log(JSON.stringify(data, null, 2))
        break
      }
    }
  }

  // ============================================================
  // PART 3: Try 1.0 API for WRO
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 3: TRY 1.0 API FOR WRO')
  console.log('█'.repeat(100))

  const api1Base = 'https://api.shipbob.com/1.0'
  
  console.log('\nTrying 1.0 API endpoints...')
  const endpoints1 = [
    '/receiving',
    '/receiving-orders',
    '/receivingorder',
    '/receiving_order',
  ]

  for (const endpoint of endpoints1) {
    console.log(`\n${api1Base}${endpoint}:`)
    const response = await fetch(`${api1Base}${endpoint}?Limit=5`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
    console.log(`  Status: ${response.status} ${response.statusText}`)
    if (response.ok) {
      const data = await response.json()
      console.log(`  ✅ Endpoint exists!`)
      console.log(`  Response: ${JSON.stringify(data).slice(0, 500)}`)
    }
  }

  // Try specific WRO lookup in 1.0
  for (const wroId of wroIds) {
    console.log(`\n--- 1.0 API WRO Lookup: ${wroId} ---`)
    
    for (const endpoint of ['/receiving', '/receivingorder']) {
      const url = `${api1Base}${endpoint}/${wroId}`
      console.log(`\n${url}:`)
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      console.log(`  Status: ${response.status} ${response.statusText}`)
      if (response.ok) {
        const data = await response.json()
        console.log(`  ✅ Found!`)
        console.log(JSON.stringify(data, null, 2))
        break
      }
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('SUMMARY')
  console.log('█'.repeat(100))

  console.log(`
WRO/Receiving Transactions Linkage:
- Transactions have reference_type="WRO" and reference_id=WRO_ID
- Need to find an API endpoint that returns WRO details with user_id/client info
- Possible strategies:
  1. If Receiving API returns user_id, JOIN via clients.shipbob_user_id
  2. If no API available, may need to sync WROs per-client with child tokens
  3. Parse from additional_details if populated in actual invoiced transactions
`)
}

main().catch(console.error)
