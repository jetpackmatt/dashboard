#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function test() {
  // Get a product with variants that we already have
  const { data: product } = await supabase
    .from('products')
    .select('shipbob_product_id, client_id')
    .not('variants', 'is', null)
    .limit(1)
    .single()

  console.log('Existing product:', product)

  // Get token for Henson
  const { data: cred } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .eq('provider', 'shipbob')
    .single()

  const token = cred?.api_token
  if (!token) {
    console.log('No token found')
    return
  }

  // Test fetching single product
  console.log('\n--- Fetching single product ---')
  const singleResp = await fetch(`https://api.shipbob.com/1.0/product/${product.shipbob_product_id}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  })
  const singleProduct = await singleResp.json()
  console.log('Single product has', singleProduct.variants?.length || 0, 'variants')
  if (singleProduct.variants?.[0]) {
    console.log('First variant:', {
      sku: singleProduct.variants[0].sku,
      inventory_id: singleProduct.variants[0].inventory?.inventory_id
    })
  }

  // Test list with ActiveStatus filter
  console.log('\n--- Fetching product list with ActiveStatus ---')
  const listResp = await fetch('https://api.shipbob.com/1.0/product?Limit=5&ActiveStatus=Any', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  })
  const products = await listResp.json()
  console.log('List returned', products.length, 'products')
  if (products[0]) {
    console.log('First product has', products[0].variants?.length || 0, 'variants')
  }

  // Test with 2025-07 API
  console.log('\n--- Fetching product list from 2025-07 API ---')
  const newResp = await fetch('https://api.shipbob.com/2025-07/product?Limit=5', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  })
  if (newResp.ok) {
    const newProducts = await newResp.json()
    const items = newProducts.items || newProducts
    console.log('2025-07 API returned', items.length, 'products')
    if (items[0]) {
      console.log('First product has', items[0].variants?.length || 0, 'variants')
    }
  } else {
    console.log('2025-07 API error:', newResp.status, newResp.statusText)
  }
}

test()
