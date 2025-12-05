#!/usr/bin/env node
/**
 * Test script to verify ShipBob sync works
 * Run with: node scripts/test-sync.js
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testSync() {
  console.log('=== ShipBob Sync Test ===\n')

  // 1. Get clients with tokens
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select(`
      id,
      company_name,
      client_api_credentials!inner(api_token)
    `)
    .eq('is_active', true)

  if (clientError) {
    console.error('Error fetching clients:', clientError.message)
    return
  }

  console.log(`Found ${clients.length} clients with tokens:\n`)

  for (const client of clients) {
    console.log(`- ${client.company_name} (${client.id})`)
    const token = client.client_api_credentials[0]?.api_token
    if (token) {
      console.log(`  Token: ${token.substring(0, 20)}...`)
    }
  }

  // 2. Test ShipBob API with first client
  if (clients.length > 0) {
    const testClient = clients[0]
    const token = testClient.client_api_credentials[0]?.api_token

    console.log(`\n\nTesting ShipBob API for ${testClient.company_name}...\n`)

    // Calculate date range (last 7 days)
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 7)

    const params = new URLSearchParams({
      StartDate: startDate.toISOString(),
      EndDate: endDate.toISOString(),
      Limit: '10',
      SortOrder: 'Newest'
    })

    try {
      const response = await fetch(`https://api.shipbob.com/1.0/order?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`ShipBob API Error: ${response.status}`)
        console.error(errorText)
        return
      }

      const orders = await response.json()
      console.log(`Fetched ${orders.length} orders from ShipBob (last 7 days, max 10)\n`)

      if (orders.length > 0) {
        const firstOrder = orders[0]
        console.log('Sample order:')
        console.log(`  Order ID: ${firstOrder.id}`)
        console.log(`  Reference: ${firstOrder.reference_id}`)
        console.log(`  Status: ${firstOrder.status}`)
        console.log(`  Created: ${firstOrder.created_date}`)

        if (firstOrder.shipments?.length > 0) {
          const shipment = firstOrder.shipments[0]
          console.log(`  Tracking: ${shipment.tracking_number || 'N/A'}`)
          console.log(`  Carrier: ${shipment.carrier || 'N/A'}`)
        }
      }

      // 3. Insert orders into shipments table
      console.log('\n\nInserting orders into shipments table...')

      let inserted = 0
      let updated = 0
      let errors = []

      for (const order of orders) {
        const shipment = order.shipments?.[0]

        const shipmentData = {
          client_id: testClient.id,
          shipbob_order_id: order.id.toString(),
          shipbob_reference_id: order.reference_id,
          store_order_id: order.order_number,
          tracking_id: shipment?.tracking_number || null,
          order_date: order.created_date ? new Date(order.created_date).toISOString().split('T')[0] : null,
          carrier: shipment?.carrier || null,
          carrier_service: shipment?.shipping_method || null,
          transaction_status: order.status,
          delivered_date: shipment?.actual_delivery_date ? new Date(shipment.actual_delivery_date).toISOString() : null,
          actual_weight_oz: shipment?.measurements?.total_weight_oz || null,
          length: shipment?.measurements?.length_in || null,
          width: shipment?.measurements?.width_in || null,
          height: shipment?.measurements?.height_in || null,
          raw_data: order,
          updated_at: new Date().toISOString(),
        }

        // Upsert using ON CONFLICT
        const { error: upsertError } = await supabase
          .from('shipments')
          .upsert(shipmentData, { onConflict: 'shipbob_order_id' })

        if (upsertError) {
          errors.push(`Order ${order.id}: ${upsertError.message}`)
        } else {
          inserted++
        }
      }

      console.log(`  Inserted/Updated: ${inserted}`)
      if (errors.length > 0) {
        console.log(`  Errors: ${errors.length}`)
        errors.forEach(e => console.log(`    - ${e}`))
      }

      // 4. Verify final count
      const { count, error: countError } = await supabase
        .from('shipments')
        .select('*', { count: 'exact', head: true })

      if (!countError) {
        console.log(`\n  Total shipments in database: ${count}`)
      }

      // 5. Test Billing API (parent token)
      console.log('\n\n--- Testing Billing API (Parent Token) ---')
      const parentToken = process.env.SHIPBOB_API_TOKEN

      if (!parentToken) {
        console.log('  SHIPBOB_API_TOKEN not set, skipping billing test')
      } else {
        // Fetch invoices
        const endDate = new Date()
        const billingStartDate = new Date()
        billingStartDate.setDate(billingStartDate.getDate() - 30)

        const invoiceParams = new URLSearchParams({
          startDate: billingStartDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          pageSize: '10'
        })

        const invoiceResponse = await fetch(`https://api.shipbob.com/2025-07/invoices?${invoiceParams}`, {
          headers: {
            'Authorization': `Bearer ${parentToken}`,
            'Content-Type': 'application/json'
          }
        })

        if (!invoiceResponse.ok) {
          console.log(`  Invoice API Error: ${invoiceResponse.status}`)
          const errorText = await invoiceResponse.text()
          console.log(`  ${errorText}`)
        } else {
          const invoiceData = await invoiceResponse.json()
          console.log(`  Invoices fetched: ${invoiceData.items?.length || 0}`)

          if (invoiceData.items?.length > 0) {
            console.log('\n  Sample invoice:')
            const inv = invoiceData.items[0]
            console.log(`    ID: ${inv.invoice_id}`)
            console.log(`    Date: ${inv.invoice_date}`)
            console.log(`    Type: ${inv.invoice_type}`)
            console.log(`    Amount: $${inv.amount}`)
          }

          // Insert invoices into invoices_sb
          console.log('\n  Inserting invoices into invoices_sb...')
          let invoicesInserted = 0
          for (const inv of invoiceData.items || []) {
            const { error } = await supabase
              .from('invoices_sb')
              .upsert({
                shipbob_invoice_id: inv.invoice_id.toString(),
                invoice_number: inv.invoice_id.toString(),
                invoice_date: inv.invoice_date,
                invoice_type: inv.invoice_type,
                base_amount: inv.amount,
                currency_code: inv.currency_code,
                period_start: billingStartDate.toISOString(),
                period_end: endDate.toISOString(),
                raw_data: inv,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'shipbob_invoice_id' })

            if (!error) invoicesInserted++
          }
          console.log(`  Invoices inserted/updated: ${invoicesInserted}`)

          // Fetch transactions
          console.log('\n  Fetching transactions...')
          const txResponse = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${parentToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              start_date: billingStartDate.toISOString().split('T')[0],
              end_date: endDate.toISOString().split('T')[0]
            })
          })

          if (!txResponse.ok) {
            console.log(`  Transaction API Error: ${txResponse.status}`)
          } else {
            const txData = await txResponse.json()
            console.log(`  Transactions fetched: ${txData.items?.length || 0}`)

            if (txData.items?.length > 0) {
              console.log('\n  Sample transaction:')
              const tx = txData.items[0]
              console.log(`    ID: ${tx.transaction_id}`)
              console.log(`    Fee: ${tx.transaction_fee}`)
              console.log(`    Amount: $${tx.amount}`)
              console.log(`    Reference: ${tx.reference_id} (${tx.reference_type})`)
            }

            // Insert transactions
            console.log('\n  Inserting transactions...')
            let txInserted = 0
            for (const tx of (txData.items || []).slice(0, 50)) { // Limit to 50 for test
              const { error } = await supabase
                .from('transactions')
                .upsert({
                  transaction_id: tx.transaction_id,
                  reference_id: tx.reference_id,
                  reference_type: tx.reference_type,
                  amount: tx.amount,
                  currency_code: tx.currency_code,
                  charge_date: tx.charge_date,
                  transaction_fee: tx.transaction_fee,
                  transaction_type: tx.transaction_type,
                  fulfillment_center: tx.fulfillment_center,
                  invoiced_status: tx.invoiced_status,
                  invoice_id: tx.invoice_id,
                  invoice_date: tx.invoice_date,
                  tracking_id: tx.additional_details?.TrackingId || null,
                  additional_details: tx.additional_details,
                  raw_data: tx,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'transaction_id' })

              if (!error) txInserted++
            }
            console.log(`  Transactions inserted/updated: ${txInserted}`)
          }
        }

        // Final counts
        const { count: invoiceCount } = await supabase.from('invoices_sb').select('*', { count: 'exact', head: true })
        const { count: txCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
        console.log(`\n  Total invoices in database: ${invoiceCount}`)
        console.log(`  Total transactions in database: ${txCount}`)
      }

      console.log('\n✅ Full sync test complete!')
      console.log('\nTo run the full sync from the UI, use Settings > Dev Tools > "Full Sync"')

    } catch (err) {
      console.error('Fetch error:', err.message)
    }
  }
}

testSync()
