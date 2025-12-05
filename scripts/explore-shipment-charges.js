#!/usr/bin/env node
/**
 * Explore /1.0/shipment/charges endpoint
 * This returned 400, meaning it exists but needs params!
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function tryRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  return { status: response.status, data, headers: Object.fromEntries(response.headers) }
}

async function main() {
  console.log('═'.repeat(100))
  console.log('EXPLORING /1.0/shipment/charges ENDPOINT')
  console.log('═'.repeat(100))

  const testShipmentId = '320860433'  // Our test shipment

  // Try different variations
  const variations = [
    // GET with query params
    { method: 'GET', url: `/1.0/shipment/charges` },
    { method: 'GET', url: `/1.0/shipment/charges?shipmentId=${testShipmentId}` },
    { method: 'GET', url: `/1.0/shipment/charges?ShipmentId=${testShipmentId}` },
    { method: 'GET', url: `/1.0/shipment/charges?id=${testShipmentId}` },
    { method: 'GET', url: `/1.0/shipment/${testShipmentId}/charges` },

    // POST
    { method: 'POST', url: `/1.0/shipment/charges`, body: { shipmentId: testShipmentId } },
    { method: 'POST', url: `/1.0/shipment/charges`, body: { ShipmentId: testShipmentId } },
    { method: 'POST', url: `/1.0/shipment/charges`, body: { shipment_id: testShipmentId } },
    { method: 'POST', url: `/1.0/shipment/charges`, body: { id: testShipmentId } },

    // Try 2025-07 version
    { method: 'GET', url: `/2025-07/shipment/charges` },
    { method: 'GET', url: `/2025-07/shipment/${testShipmentId}/charges` },
    { method: 'GET', url: `/2025-07/shipment/charges?shipmentId=${testShipmentId}` },

    // Try charges endpoint variations
    { method: 'GET', url: `/1.0/charges` },
    { method: 'GET', url: `/1.0/charges?shipmentId=${testShipmentId}` },
    { method: 'GET', url: `/2025-07/charges` },

    // Try order charges
    { method: 'GET', url: `/1.0/order/${testShipmentId}/charges` },
    { method: 'GET', url: `/2025-07/order/${testShipmentId}/charges` },
  ]

  for (const v of variations) {
    console.log(`\n--- ${v.method} ${v.url} ---`)
    if (v.body) console.log(`Body: ${JSON.stringify(v.body)}`)

    const options = { method: v.method }
    if (v.body) options.body = JSON.stringify(v.body)

    const result = await tryRequest(`${BASE_URL}${v.url}`, options)

    console.log(`Status: ${result.status}`)

    if (result.status !== 404) {
      console.log('Response:')
      console.log(typeof result.data === 'string' ? result.data.slice(0, 500) : JSON.stringify(result.data, null, 2).slice(0, 1000))
    }
  }

  // Also try to find any documentation about the 1.0 API
  console.log('\n' + '█'.repeat(80))
  console.log('TRYING TO UNDERSTAND 1.0 API STRUCTURE')
  console.log('█'.repeat(80))

  // Try listing shipment with details
  const shipmentEndpoints = [
    `/1.0/shipment?Id=${testShipmentId}`,
    `/1.0/shipment/${testShipmentId}`,
    `/1.0/shipment?orderId=${testShipmentId}`,
  ]

  for (const url of shipmentEndpoints) {
    console.log(`\n--- GET ${url} ---`)
    const result = await tryRequest(`${BASE_URL}${url}`)
    console.log(`Status: ${result.status}`)

    if (result.status === 200) {
      console.log('SUCCESS! Response:')
      console.log(JSON.stringify(result.data, null, 2).slice(0, 2000))
    } else if (result.status !== 404) {
      console.log('Response:', JSON.stringify(result.data).slice(0, 500))
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
