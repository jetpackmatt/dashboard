import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ShipBobClient, type ShipBobInvoice, type ShipBobTransaction } from '@/lib/shipbob/client'
import {
  fetchShippingBreakdown,
  updateTransactionsWithBreakdown,
} from '@/lib/billing/sftp-client'
import {
  runPreflightValidation,
  formatValidationResult,
  type ValidationResult,
} from '@/lib/billing/preflight-validation'

/**
 * GET /api/cron/sync-invoices
 *
 * Vercel Cron Job: Runs every Monday at 6:30pm PT (1:30am Tuesday UTC)
 *
 * This route syncs new ShipBob invoices, SFTP breakdown, and runs preflight validation.
 * It does NOT generate invoices - that's a manual step in the Admin UI.
 *
 * Flow:
 * 1. Fetch new invoices from ShipBob API and upsert into invoices_sb
 * 1.5. Link transactions to invoices via /invoices/{id}/transactions API
 *      (This is critical - updates transactions.invoice_id_sb so preflight can find them)
 * 2. Fetch SFTP shipping breakdown (if available)
 * 3. Update transactions with breakdown data
 * 4. Get all active clients
 * 5. Get ALL unprocessed ShipBob invoices
 * 6. For each client: run preflight validation
 * 7. Return results for admin review
 *
 * After this runs, an admin:
 * 1. Reviews preflight results in Admin UI
 * 2. Manually clicks "Generate Invoices" to create drafts
 * 3. Reviews drafts, downloads PDF/XLS
 * 4. Approves (which marks transactions)
 */
export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes - SFTP breakdown can be slow

export async function GET(request: Request) {
  try {
    // Verify this is a Vercel cron request
    const authHeader = request.headers.get('authorization')

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('Starting invoice sync (preflight only)...')

    const adminClient = createAdminClient()

    // Calculate invoice date (this Monday)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    const invoiceDate = new Date(today)
    invoiceDate.setDate(today.getDate() - daysToMonday)
    invoiceDate.setHours(0, 0, 0, 0)

    console.log(`Invoice date: ${invoiceDate.toISOString().split('T')[0]}`)

    // Step 1: Fetch new invoices from ShipBob API
    console.log('Fetching invoices from ShipBob API...')
    const invoiceSyncStats = { fetched: 0, inserted: 0, existing: 0, errors: 0 }
    const transactionLinkStats = { linked: 0, notFound: 0, invoicesProcessed: 0 }

    try {
      const shipbob = new ShipBobClient()

      // Fetch invoices from last 30 days to ensure we catch any new ones
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const allInvoices: ShipBobInvoice[] = []
      let cursor: string | undefined

      // Paginate through all invoices
      do {
        const response = await shipbob.billing.getInvoices({
          startDate: thirtyDaysAgo.toISOString().split('T')[0],
          pageSize: 100,
          cursor,
        })

        const items = response.items || []
        allInvoices.push(...items)
        cursor = response.next
      } while (cursor)

      console.log(`  Fetched ${allInvoices.length} invoices from ShipBob API`)
      invoiceSyncStats.fetched = allInvoices.length

      // Get existing invoice IDs from database
      const { data: existingInvoices } = await adminClient
        .from('invoices_sb')
        .select('shipbob_invoice_id')

      const existingIds = new Set((existingInvoices || []).map((inv: { shipbob_invoice_id: string }) => inv.shipbob_invoice_id))

      // Filter to only new invoices
      const newInvoices = allInvoices.filter(inv => !existingIds.has(String(inv.invoice_id)))
      invoiceSyncStats.existing = allInvoices.length - newInvoices.length

      if (newInvoices.length > 0) {
        console.log(`  Found ${newInvoices.length} new invoices to insert`)

        // Calculate period dates (invoice covers prior week Mon-Sun)
        const getInvoicePeriod = (invoiceDateStr: string) => {
          const invDate = new Date(invoiceDateStr)
          // Period end is Sunday before invoice date
          const periodEnd = new Date(invDate)
          periodEnd.setDate(periodEnd.getDate() - 1)
          // Period start is Monday of that week
          const periodStart = new Date(periodEnd)
          periodStart.setDate(periodStart.getDate() - 6)
          return { periodStart, periodEnd }
        }

        // Prepare records for insert
        const records = newInvoices.map(inv => {
          const { periodStart, periodEnd } = getInvoicePeriod(inv.invoice_date)
          return {
            shipbob_invoice_id: String(inv.invoice_id),
            invoice_date: inv.invoice_date,
            invoice_type: inv.invoice_type,
            base_amount: inv.amount,
            currency_code: inv.currency_code || 'USD',
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            raw_data: inv,
          }
        })

        // Insert new invoices
        const { error: insertError } = await adminClient
          .from('invoices_sb')
          .insert(records)

        if (insertError) {
          console.error('Error inserting invoices:', insertError)
          invoiceSyncStats.errors = newInvoices.length
        } else {
          invoiceSyncStats.inserted = newInvoices.length
          console.log(`  Inserted ${newInvoices.length} new invoices into invoices_sb`)
          newInvoices.forEach(inv => {
            console.log(`    - ${inv.invoice_id}: ${inv.invoice_type}, ${inv.invoice_date}, $${inv.amount}`)
          })
        }
      } else {
        console.log('  No new invoices to insert')
      }

      // Step 1.5: Link transactions to invoices via /invoices/{id}/transactions API
      // This updates transactions.invoice_id_sb for all transactions in each invoice
      // AND inserts any missing transactions with proper client attribution
      // Skip Payment invoices as they don't have transactions
      const invoicesToLink = allInvoices.filter(inv => inv.invoice_type !== 'Payment')

      console.log(`Linking transactions to ${invoicesToLink.length} invoices...`)
      transactionLinkStats.invoicesProcessed = invoicesToLink.length

      // Build lookup tables for client attribution (same logic as syncAllTransactions)
      // CRITICAL: Must use cursor-based pagination - Supabase returns MAX 1000 rows per query!
      console.log('  Building lookup tables for client attribution (with pagination)...')

      // Helper for paginated fetches (Supabase max 1000 rows per query)
      const PAGE_SIZE = 1000

      // Shipment -> client lookup (paginated)
      const shipmentLookup: Record<string, string> = {}
      let lastShipmentId: string | null = null
      while (true) {
        let query = adminClient
          .from('shipments')
          .select('shipment_id, client_id')
          .order('shipment_id', { ascending: true })
          .limit(PAGE_SIZE)
        if (lastShipmentId) {
          query = query.gt('shipment_id', lastShipmentId)
        }
        const { data: shipmentPage } = await query
        if (!shipmentPage || shipmentPage.length === 0) break
        for (const s of shipmentPage) {
          if (s.client_id) {
            shipmentLookup[s.shipment_id] = s.client_id
          }
        }
        lastShipmentId = shipmentPage[shipmentPage.length - 1].shipment_id
        if (shipmentPage.length < PAGE_SIZE) break
      }

      // Return -> client lookup (paginated)
      const returnLookup: Record<string, string> = {}
      let lastReturnId: number | null = null
      while (true) {
        let query = adminClient
          .from('returns')
          .select('shipbob_return_id, client_id')
          .order('shipbob_return_id', { ascending: true })
          .limit(PAGE_SIZE)
        if (lastReturnId !== null) {
          query = query.gt('shipbob_return_id', lastReturnId)
        }
        const { data: returnPage } = await query
        if (!returnPage || returnPage.length === 0) break
        for (const r of returnPage) {
          if (r.shipbob_return_id && r.client_id) {
            returnLookup[String(r.shipbob_return_id)] = r.client_id
          }
        }
        if (returnPage.length > 0) {
          lastReturnId = returnPage[returnPage.length - 1].shipbob_return_id
        }
        if (returnPage.length < PAGE_SIZE) break
      }

      // WRO -> client lookup (paginated)
      const wroLookup: Record<string, { client_id: string; merchant_id: string | null }> = {}
      let lastWroId: string | null = null
      while (true) {
        let query = adminClient
          .from('receiving_orders')
          .select('shipbob_receiving_id, client_id, merchant_id')
          .order('shipbob_receiving_id', { ascending: true })
          .limit(PAGE_SIZE)
        if (lastWroId) {
          query = query.gt('shipbob_receiving_id', lastWroId)
        }
        const { data: wroPage } = await query
        if (!wroPage || wroPage.length === 0) break
        for (const w of wroPage) {
          if (w.shipbob_receiving_id && w.client_id) {
            wroLookup[String(w.shipbob_receiving_id)] = {
              client_id: w.client_id,
              merchant_id: w.merchant_id,
            }
          }
        }
        if (wroPage.length > 0) {
          lastWroId = wroPage[wroPage.length - 1].shipbob_receiving_id
        }
        if (wroPage.length < PAGE_SIZE) break
      }

      // Inventory -> client lookup (for FC/storage transactions) - paginated
      const inventoryLookup: Record<string, string> = {}
      let lastProductId: string | null = null
      while (true) {
        let query = adminClient
          .from('products')
          .select('id, variants, client_id')
          .order('id', { ascending: true })
          .limit(PAGE_SIZE)
        if (lastProductId) {
          query = query.gt('id', lastProductId)
        }
        const { data: productPage } = await query
        if (!productPage || productPage.length === 0) break
        for (const p of productPage) {
          if (p.variants && Array.isArray(p.variants) && p.client_id) {
            for (const v of p.variants as Array<{ inventory?: { inventory_id?: number } }>) {
              if (v.inventory?.inventory_id) {
                inventoryLookup[String(v.inventory.inventory_id)] = p.client_id
              }
            }
          }
        }
        lastProductId = productPage[productPage.length - 1].id
        if (productPage.length < PAGE_SIZE) break
      }

      // Client info lookup for merchant_id (small table, no pagination needed but safe to paginate)
      const { data: clientsData } = await adminClient
        .from('clients')
        .select('id, merchant_id')
      const clientInfoLookup: Record<string, { merchant_id: string | null }> = {}
      for (const c of clientsData || []) {
        clientInfoLookup[c.id] = { merchant_id: c.merchant_id }
      }

      console.log(`  Lookups: ${Object.keys(shipmentLookup).length} shipments, ${Object.keys(returnLookup).length} returns, ${Object.keys(wroLookup).length} WROs, ${Object.keys(inventoryLookup).length} inventory`)

      // Helper function to attribute client_id based on reference_type
      const attributeClient = (tx: ShipBobTransaction): { client_id: string | null; merchant_id: string | null } => {
        let clientId: string | null = null

        if (tx.reference_type === 'Shipment') {
          clientId = shipmentLookup[tx.reference_id] || null
        } else if (tx.reference_type === 'FC') {
          // Parse InventoryId from reference_id: {FC_ID}-{InventoryId}-{LocationType}
          const parts = tx.reference_id?.split('-') || []
          let invId: string | null = null
          if (parts.length >= 2) {
            invId = parts[1]
          }
          if (!invId && tx.additional_details?.InventoryId) {
            invId = String(tx.additional_details.InventoryId)
          }
          if (invId) {
            clientId = inventoryLookup[invId] || null
          }
        } else if (tx.reference_type === 'Return') {
          clientId = returnLookup[tx.reference_id] || null
        } else if (tx.reference_type === 'WRO' || tx.reference_type === 'URO') {
          const info = wroLookup[tx.reference_id]
          if (info) {
            clientId = info.client_id
          }
        } else if (tx.reference_type === 'Default') {
          // Credits have reference_type='Default' but reference_id is often a shipment_id
          // Try shipment lookup first, then return, then WRO
          if (tx.transaction_fee === 'Credit') {
            clientId = shipmentLookup[tx.reference_id] || null
            if (!clientId) {
              clientId = returnLookup[tx.reference_id] || null
            }
            if (!clientId) {
              const wroInfo = wroLookup[tx.reference_id]
              if (wroInfo) {
                clientId = wroInfo.client_id
              }
            }
          }
        }

        // Get merchant_id from client
        let merchantId: string | null = null
        if (clientId) {
          merchantId = clientInfoLookup[clientId]?.merchant_id || null
        }

        return { client_id: clientId, merchant_id: merchantId }
      }

      let totalInserted = 0

      for (const invoice of invoicesToLink) {
        try {
          // Use /invoices/{id}/transactions endpoint with pagination
          let invoiceTransactions = await shipbob.billing.getTransactionsByInvoice(invoice.invoice_id)

          // WORKAROUND: ShipBob's /invoices/{id}/transactions returns 0 for WarehouseStorage invoices
          // For these invoice types, query transactions by matching invoice_id from our DB directly
          // The transactions already have invoice_id set in the API (verified), just not returned via this endpoint
          if (invoiceTransactions.length === 0 &&
              (invoice.invoice_type === 'WarehouseStorage' || invoice.invoice_type === 'WarehouseInboundFee')) {
            console.log(`  Invoice ${invoice.invoice_id} (${invoice.invoice_type}): API returned 0, using DB fallback...`)

            // Get the invoice period from our invoices_sb table
            const { data: invoiceSb } = await adminClient
              .from('invoices_sb')
              .select('period_start, period_end')
              .eq('shipbob_invoice_id', String(invoice.invoice_id))
              .single()

            if (invoiceSb?.period_start && invoiceSb?.period_end) {
              const periodStart = invoiceSb.period_start.split('T')[0]
              const periodEnd = invoiceSb.period_end.split('T')[0]

              // Reference type mapping: WarehouseStorage → FC, WarehouseInboundFee → WRO
              const refType = invoice.invoice_type === 'WarehouseStorage' ? 'FC' : 'WRO'

              // Find transactions in our DB that match this period and type
              const { data: matchingTx } = await adminClient
                .from('transactions')
                .select('transaction_id')
                .eq('reference_type', refType)
                .is('invoice_id_sb', null)
                .gte('charge_date', periodStart)
                .lte('charge_date', periodEnd)

              if (matchingTx && matchingTx.length > 0) {
                // Update these transactions with the invoice_id_sb
                const BATCH_SIZE = 500
                let dbFallbackLinked = 0

                for (let i = 0; i < matchingTx.length; i += BATCH_SIZE) {
                  const batch = matchingTx.slice(i, i + BATCH_SIZE).map((t: { transaction_id: string }) => t.transaction_id)

                  const { data: updated, error: updateError } = await adminClient
                    .from('transactions')
                    .update({
                      invoice_id_sb: invoice.invoice_id,
                      invoice_date_sb: invoice.invoice_date,
                      invoiced_status_sb: true
                    })
                    .in('transaction_id', batch)
                    .select('id')

                  if (!updateError && updated) {
                    dbFallbackLinked += updated.length
                  }
                }

                transactionLinkStats.linked += dbFallbackLinked
                console.log(`    DB fallback: linked ${dbFallbackLinked} ${refType} transactions to invoice ${invoice.invoice_id}`)
              }
            }
            continue
          }

          if (invoiceTransactions.length === 0) {
            continue
          }

          // Get transaction IDs from this invoice
          const transactionIds = invoiceTransactions.map(tx => tx.transaction_id)

          // Check which transactions already exist in DB (paginate to handle >1000 transactions)
          const existingIds = new Set<string>()
          const TX_CHECK_BATCH = 500 // Use smaller batches for .in() queries
          for (let i = 0; i < transactionIds.length; i += TX_CHECK_BATCH) {
            const batch = transactionIds.slice(i, i + TX_CHECK_BATCH)
            const { data: existingTx } = await adminClient
              .from('transactions')
              .select('transaction_id')
              .in('transaction_id', batch)
            for (const t of existingTx || []) {
              existingIds.add(t.transaction_id)
            }
          }

          // Split into existing (UPDATE) and missing (INSERT)
          const toUpdate = invoiceTransactions.filter(tx => existingIds.has(tx.transaction_id))
          const toInsert = invoiceTransactions.filter(tx => !existingIds.has(tx.transaction_id))

          // Batch update existing transactions
          const BATCH_SIZE = 500
          let totalLinked = 0
          let totalErrors = 0

          for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
            const batch = toUpdate.slice(i, i + BATCH_SIZE).map(tx => tx.transaction_id)

            const { data: updated, error: updateError } = await adminClient
              .from('transactions')
              .update({
                invoice_id_sb: invoice.invoice_id,
                invoice_date_sb: invoice.invoice_date,
                invoiced_status_sb: true
              })
              .in('transaction_id', batch)
              .select('id')

            if (updateError) {
              console.error(`  Error linking batch ${Math.floor(i / BATCH_SIZE) + 1} for invoice ${invoice.invoice_id}:`, updateError)
              totalErrors++
            } else {
              totalLinked += updated?.length || 0
            }
          }

          // Update taxes for transactions that have them (GST/HST for Canadian FCs)
          // This is a separate pass because we need individual updates per transaction
          const txWithTaxes = toUpdate.filter(tx => tx.taxes && tx.taxes.length > 0)
          if (txWithTaxes.length > 0) {
            let taxesUpdated = 0
            for (const tx of txWithTaxes) {
              const { error: taxError } = await adminClient
                .from('transactions')
                .update({ taxes: tx.taxes })
                .eq('transaction_id', tx.transaction_id)
              if (!taxError) taxesUpdated++
            }
            if (taxesUpdated > 0) {
              console.log(`    Updated taxes for ${taxesUpdated} Canadian transactions`)
            }
          }

          // Insert missing transactions with client attribution
          let insertedCount = 0
          if (toInsert.length > 0) {
            const now = new Date().toISOString()
            const records = toInsert.map(tx => {
              const { client_id, merchant_id } = attributeClient(tx)
              // Build base record WITHOUT client_id/merchant_id
              // IMPORTANT: Only include these if NOT null to prevent overwriting existing attribution
              const record: Record<string, unknown> = {
                transaction_id: tx.transaction_id,
                reference_id: tx.reference_id,
                reference_type: tx.reference_type,
                transaction_type: tx.transaction_type || null,
                fee_type: tx.transaction_fee,
                cost: tx.amount,
                charge_date: tx.charge_date,
                invoice_date_sb: tx.invoice_date || invoice.invoice_date,
                invoiced_status_sb: true,
                invoice_id_sb: invoice.invoice_id,
                fulfillment_center: tx.fulfillment_center || null,
                additional_details: tx.additional_details || null,
                updated_at: now,
              }
              // Only include tracking_id if we have it (don't overwrite existing with null)
              if (tx.additional_details?.TrackingId) {
                record.tracking_id = tx.additional_details.TrackingId
              }
              // Only include taxes if present
              if (tx.taxes && tx.taxes.length > 0) {
                record.taxes = tx.taxes
              }
              // Only include client_id/merchant_id if attribution succeeded
              if (client_id) {
                record.client_id = client_id
                record.merchant_id = merchant_id
              }
              return record
            })

            // Insert in batches
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
              const batch = records.slice(i, i + BATCH_SIZE)
              const { error: insertError, count } = await adminClient
                .from('transactions')
                .upsert(batch, { onConflict: 'transaction_id', count: 'exact' })

              if (insertError) {
                console.error(`  Error inserting batch ${Math.floor(i / BATCH_SIZE) + 1} for invoice ${invoice.invoice_id}:`, insertError)
              } else {
                insertedCount += count || batch.length
              }
            }
            totalInserted += insertedCount
          }

          transactionLinkStats.linked += totalLinked
          transactionLinkStats.notFound += toInsert.length // Now "notFound" means "inserted"

          if (totalLinked > 0 || insertedCount > 0 || totalErrors > 0) {
            console.log(`  Invoice ${invoice.invoice_id} (${invoice.invoice_type}): ${totalLinked} updated, ${insertedCount} inserted${totalErrors > 0 ? `, ${totalErrors} batch errors` : ''}`)
          }

          // DB FALLBACK for ALL invoice types: Link transactions that exist in our DB
          // but were NOT returned by ShipBob's /invoices/{id}/transactions API.
          // This handles the case where transactions were synced by sync-transactions
          // before the invoice existed, and ShipBob's API doesn't return them.
          // Get the invoice period from our invoices_sb table
          const { data: invoiceSb } = await adminClient
            .from('invoices_sb')
            .select('period_start, period_end')
            .eq('shipbob_invoice_id', String(invoice.invoice_id))
            .single()

          if (invoiceSb?.period_start && invoiceSb?.period_end) {
            const periodStart = invoiceSb.period_start.split('T')[0]
            const periodEnd = invoiceSb.period_end.split('T')[0]

            // Build query based on invoice type:
            // - Shipping: reference_type='Shipment', fee_type='Shipping'
            // - AdditionalFee: reference_type='Shipment', fee_type NOT IN ('Shipping', 'Credit')
            // - WarehouseStorage: reference_type='FC'
            // - WarehouseInboundFee: reference_type IN ('WRO', 'URO')
            // - ReturnsFee: reference_type='Return'
            // - Credits: fee_type='Credit' OR reference_type='Default'
            let query = adminClient
              .from('transactions')
              .select('transaction_id')
              .is('invoice_id_sb', null)
              .is('dispute_status', null)
              .gte('charge_date', periodStart)
              .lte('charge_date', periodEnd + 'T23:59:59Z')

            // Apply invoice-type-specific filters
            switch (invoice.invoice_type) {
              case 'Shipping':
                query = query.eq('reference_type', 'Shipment').eq('fee_type', 'Shipping')
                break
              case 'AdditionalFee':
                // Additional Services includes:
                // 1. Shipment fees that aren't Shipping or Credit (Per Pick Fee, B2B fees, etc.)
                // 2. Inventory Placement Program Fee (has reference_type='WRO' but isn't a receiving fee)
                query = query.or(
                  'and(reference_type.eq.Shipment,fee_type.neq.Shipping,fee_type.neq.Credit),' +
                  'and(reference_type.eq.WRO,fee_type.ilike.%Inventory Placement%)'
                )
                break
              case 'WarehouseStorage':
                query = query.eq('reference_type', 'FC')
                break
              case 'WarehouseInboundFee':
                // Only match actual receiving fees, not service fees like Inventory Placement Program Fee
                // which belong on AdditionalFee invoice despite having reference_type='WRO'
                query = query.in('reference_type', ['WRO', 'URO'])
                  .not('fee_type', 'ilike', '%Inventory Placement%')
                break
              case 'ReturnsFee':
                query = query.eq('reference_type', 'Return')
                break
              case 'Credits':
                // Credits can have various reference_types but fee_type='Credit'
                query = query.eq('fee_type', 'Credit')
                break
              default:
                // Unknown invoice type - skip fallback
                query = null
            }

            if (query) {
              const { data: unlinkedTx } = await query

              if (unlinkedTx && unlinkedTx.length > 0) {
                // Update these transactions with the invoice_id_sb
                let dbFallbackLinked = 0
                for (let i = 0; i < unlinkedTx.length; i += BATCH_SIZE) {
                  const batch = unlinkedTx.slice(i, i + BATCH_SIZE).map((t: { transaction_id: string }) => t.transaction_id)

                  const { data: updated, error: updateError } = await adminClient
                    .from('transactions')
                    .update({
                      invoice_id_sb: invoice.invoice_id,
                      invoice_date_sb: invoice.invoice_date,
                      invoiced_status_sb: true
                    })
                    .in('transaction_id', batch)
                    .select('id')

                  if (!updateError && updated) {
                    dbFallbackLinked += updated.length
                  }
                }

                if (dbFallbackLinked > 0) {
                  transactionLinkStats.linked += dbFallbackLinked
                  console.log(`    DB fallback: linked ${dbFallbackLinked} additional ${invoice.invoice_type} transactions to invoice ${invoice.invoice_id}`)
                }
              }
            }
          }
        } catch (err: unknown) {
          // Log detailed error info for debugging
          const error = err as { status?: number; response?: unknown; message?: string }
          console.error(`  Error fetching transactions for invoice ${invoice.invoice_id} (${invoice.invoice_type}):`, {
            status: error.status,
            message: error.message,
            response: JSON.stringify(error.response)
          })
        }
      }

      console.log(`Transaction linking complete: ${transactionLinkStats.linked} updated, ${totalInserted} inserted (were missing from DB)`)

      // Invoice-sibling attribution: For transactions with NULL client_id,
      // check if all siblings on the same invoice have the same client_id.
      // This handles courtesy credits (reference_id=0) that can't be attributed directly.
      const invoiceIdsProcessed = invoicesToLink.map(inv => inv.invoice_id)
      if (invoiceIdsProcessed.length > 0) {
        // Paginate orphan query - can be more than 1000 unattributed transactions
        const orphanTx: Array<{ transaction_id: string; invoice_id_sb: number }> = []
        let lastOrphanId: string | null = null
        while (true) {
          let query = adminClient
            .from('transactions')
            .select('transaction_id, invoice_id_sb')
            .in('invoice_id_sb', invoiceIdsProcessed)
            .is('client_id', null)
            .order('transaction_id', { ascending: true })
            .limit(PAGE_SIZE)
          if (lastOrphanId) {
            query = query.gt('transaction_id', lastOrphanId)
          }
          const { data: orphanPage } = await query
          if (!orphanPage || orphanPage.length === 0) break
          orphanTx.push(...orphanPage)
          lastOrphanId = orphanPage[orphanPage.length - 1].transaction_id
          if (orphanPage.length < PAGE_SIZE) break
        }

        if (orphanTx.length > 0) {
          console.log(`Found ${orphanTx.length} transactions with NULL client_id - attempting sibling attribution...`)

          // Group orphans by invoice
          const orphansByInvoice = new Map<number, string[]>()
          for (const tx of orphanTx) {
            const invId = tx.invoice_id_sb
            if (!orphansByInvoice.has(invId)) {
              orphansByInvoice.set(invId, [])
            }
            orphansByInvoice.get(invId)!.push(tx.transaction_id)
          }

          let siblingAttributed = 0
          for (const [invoiceId, txIds] of orphansByInvoice) {
            // Find all distinct client_ids on this invoice (excluding NULL)
            // Paginate in case invoice has >1000 transactions
            const clientIdSet = new Set<string>()
            let lastSiblingTxId: string | null = null
            while (true) {
              let query = adminClient
                .from('transactions')
                .select('transaction_id, client_id')
                .eq('invoice_id_sb', invoiceId)
                .not('client_id', 'is', null)
                .order('transaction_id', { ascending: true })
                .limit(PAGE_SIZE)
              if (lastSiblingTxId) {
                query = query.gt('transaction_id', lastSiblingTxId)
              }
              const { data: siblingPage } = await query
              if (!siblingPage || siblingPage.length === 0) break
              for (const s of siblingPage) {
                if (s.client_id) clientIdSet.add(s.client_id)
              }
              lastSiblingTxId = siblingPage[siblingPage.length - 1].transaction_id
              if (siblingPage.length < PAGE_SIZE) break
              // Early exit if we already found multiple clients
              if (clientIdSet.size > 1) break
            }

            if (clientIdSet.size === 1) {
              const siblingClientId = [...clientIdSet][0]
              // Update orphans with sibling's client_id (batch if >500)
              for (let i = 0; i < txIds.length; i += 500) {
                const batch = txIds.slice(i, i + 500)
                const { error: updateErr } = await adminClient
                  .from('transactions')
                  .update({ client_id: siblingClientId })
                  .in('transaction_id', batch)

                if (!updateErr) {
                  siblingAttributed += batch.length
                }
              }
              console.log(`  Invoice ${invoiceId}: attributed ${txIds.length} orphan(s) to client ${siblingClientId}`)
            } else if (clientIdSet.size > 1) {
              console.log(`  Invoice ${invoiceId}: multiple clients (${clientIdSet.size}), skipping ${txIds.length} orphan(s)`)
            }
          }

          if (siblingAttributed > 0) {
            console.log(`Sibling attribution complete: ${siblingAttributed} transactions updated`)
          }
        }
      }

    } catch (err) {
      console.error('Error fetching invoices from ShipBob:', err)
      // Continue with preflight even if invoice sync fails
    }

    // Step 2: Fetch shipping breakdown data from SFTP (if available)
    console.log('Fetching shipping breakdown from SFTP...')
    const sftpResult = await fetchShippingBreakdown(invoiceDate)

    let breakdownStats = { fetched: 0, updated: 0, notFound: 0, errors: 0 }

    if (sftpResult.success && sftpResult.rows.length > 0) {
      console.log(`Found ${sftpResult.rows.length} breakdown rows in ${sftpResult.filename}`)

      const updateResult = await updateTransactionsWithBreakdown(adminClient, sftpResult.rows)
      breakdownStats = {
        fetched: sftpResult.rows.length,
        updated: updateResult.updated,
        notFound: updateResult.notFound,
        errors: updateResult.errors.length
      }

      console.log(`Updated ${updateResult.updated} transactions with breakdown data`)
      if (updateResult.notFound > 0) {
        console.log(`  ${updateResult.notFound} shipments not found in transactions`)
      }
      if (updateResult.errors.length > 0) {
        console.log(`  ${updateResult.errors.length} errors:`, updateResult.errors.slice(0, 3))
      }
    } else if (!sftpResult.success) {
      console.log(`SFTP fetch failed: ${sftpResult.error}`)
      console.log('Continuing with preflight (breakdown data may be incomplete)')
    } else {
      console.log('No breakdown data in SFTP file')
    }

    // Step 3: Get all active clients with billing info (exclude internal/system entries)
    const { data: clients, error: clientsError } = await adminClient
      .from('clients')
      .select('id, company_name, short_code, merchant_id')
      .eq('is_active', true)
      .or('is_internal.is.null,is_internal.eq.false')

    if (clientsError || !clients) {
      console.error('Error fetching clients:', clientsError)
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    // Step 4: Get ALL unprocessed ShipBob invoices (PARENT TOKEN level - shared across clients)
    // Source of truth: invoices_sb.jetpack_invoice_id IS NULL
    // Exclude Payment type (not billable)
    const { data: unprocessedInvoices, error: invoicesError } = await adminClient
      .from('invoices_sb')
      .select('id, shipbob_invoice_id, invoice_type, base_amount, invoice_date')
      .is('jetpack_invoice_id', null)
      .neq('invoice_type', 'Payment')
      .order('invoice_date', { ascending: true })

    if (invoicesError) {
      console.error('Error fetching unprocessed invoices:', invoicesError)
      return NextResponse.json({ error: 'Failed to fetch unprocessed invoices' }, { status: 500 })
    }

    if (!unprocessedInvoices || unprocessedInvoices.length === 0) {
      console.log('No unprocessed ShipBob invoices found')
      return NextResponse.json({
        success: true,
        message: 'No unprocessed ShipBob invoices',
        invoiceSync: invoiceSyncStats,
        transactionLinking: transactionLinkStats,
        shippingBreakdown: breakdownStats,
        shipbobInvoices: [],
        preflightResults: [],
        readyForGeneration: false,
      })
    }

    // Extract ShipBob invoice IDs
    const shipbobInvoiceIds = unprocessedInvoices
      .map((inv: { shipbob_invoice_id: string }) => parseInt(inv.shipbob_invoice_id, 10))
      .filter((id: number): id is number => !isNaN(id))

    console.log(`Found ${unprocessedInvoices.length} unprocessed ShipBob invoices`)
    console.log(`  Invoice IDs: ${shipbobInvoiceIds.join(', ')}`)
    console.log(`  Types: ${[...new Set(unprocessedInvoices.map((i: { invoice_type: string }) => i.invoice_type))].join(', ')}`)

    // Step 5: Run preflight validation for each client
    const preflightResults: Array<{
      client: string
      clientId: string
      hasTransactions: boolean
      validation: ValidationResult | null
      passed: boolean
      issues: number
      warnings: number
    }> = []

    for (const client of clients) {
      if (!client.short_code) {
        preflightResults.push({
          client: client.company_name,
          clientId: client.id,
          hasTransactions: false,
          validation: null,
          passed: false,
          issues: 1,
          warnings: 0,
        })
        continue
      }

      try {
        // Check if client has transactions in these invoices
        const { count } = await adminClient
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .in('invoice_id_sb', shipbobInvoiceIds)
          .is('invoice_id_jp', null)

        if (!count || count === 0) {
          // No transactions for this client in this period
          continue
        }

        console.log(`Running preflight for ${client.company_name} (${count} transactions)...`)

        const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds)

        console.log(formatValidationResult(validation))

        preflightResults.push({
          client: client.company_name,
          clientId: client.id,
          hasTransactions: true,
          validation,
          passed: validation.passed,
          issues: validation.issues.length,
          warnings: validation.warnings.length,
        })
      } catch (err) {
        console.error(`Error running preflight for ${client.company_name}:`, err)
        preflightResults.push({
          client: client.company_name,
          clientId: client.id,
          hasTransactions: false,
          validation: null,
          passed: false,
          issues: 1,
          warnings: 0,
        })
      }
    }

    // Summary
    const clientsWithData = preflightResults.filter(r => r.hasTransactions)
    const clientsPassed = clientsWithData.filter(r => r.passed)
    const clientsFailed = clientsWithData.filter(r => !r.passed)
    const readyForGeneration = clientsFailed.length === 0 && clientsPassed.length > 0

    console.log('\n========================================')
    console.log('SYNC COMPLETE - PREFLIGHT RESULTS')
    console.log('========================================')
    console.log(`ShipBob Invoices: ${unprocessedInvoices.length}`)
    console.log(`Clients with transactions: ${clientsWithData.length}`)
    console.log(`  Passed: ${clientsPassed.length}`)
    console.log(`  Failed: ${clientsFailed.length}`)
    console.log(`Ready for generation: ${readyForGeneration ? 'YES' : 'NO'}`)
    console.log('========================================')
    console.log('Next step: Admin reviews in UI, then manually generates invoices')
    console.log('========================================\n')

    return NextResponse.json({
      success: true,
      message: 'Sync complete - ready for admin review',
      invoiceSync: invoiceSyncStats,
      transactionLinking: transactionLinkStats,
      shippingBreakdown: breakdownStats,
      shipbobInvoices: unprocessedInvoices.map((inv: { shipbob_invoice_id: string; invoice_type: string; base_amount: number; invoice_date: string }) => ({
        id: inv.shipbob_invoice_id,
        type: inv.invoice_type,
        amount: inv.base_amount,
        date: inv.invoice_date,
      })),
      preflightResults: preflightResults.filter(r => r.hasTransactions).map(r => ({
        client: r.client,
        clientId: r.clientId,
        passed: r.passed,
        issues: r.issues,
        warnings: r.warnings,
        summary: r.validation?.summary || null,
      })),
      summary: {
        totalShipbobInvoices: unprocessedInvoices.length,
        clientsWithTransactions: clientsWithData.length,
        clientsPassed: clientsPassed.length,
        clientsFailed: clientsFailed.length,
      },
      readyForGeneration,
    })
  } catch (error) {
    console.error('Error in invoice sync:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
