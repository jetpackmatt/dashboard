/**
 * Attribute client_id to transactions that are missing it
 *
 * Attribution strategies by reference_type:
 * 1. Shipment: Lookup via shipments table (shipment_id → client_id)
 * 2. FC (Storage): Parse InventoryId from reference_id format {FC_ID}-{InventoryId}-{LocationType}
 *                  or fallback to additional_details.InventoryId, lookup via billing_storage
 * 3. Return: Sync Returns API per client → build return_id → client lookup
 * 4. WRO/URO: Fallback to invoice-based attribution (same invoice = same client)
 * 5. TicketNumber: Parse client name from additional_details.Comment
 * 6. Default (Payments): Attribute to "ShipBob Payments" system client
 * 7. Final fallback: Invoice-based attribution for any remaining unattributed
 *
 * Usage:
 *   node scripts/attribute-transactions.js           # Run attribution
 *   node scripts/attribute-transactions.js --dry-run # Preview only
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API = 'https://api.shipbob.com/2025-07'
const BATCH_SIZE = 500

const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log('='.repeat(70))
  console.log('TRANSACTION CLIENT ATTRIBUTION')
  console.log('='.repeat(70))
  if (dryRun) console.log('DRY RUN MODE - no changes will be made\n')

  // Get all clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  console.log('Active clients:', clients?.length || 0)

  // =====================================================
  // 1. FC (Storage) Attribution via billing_storage
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('1. FC (STORAGE) ATTRIBUTION')
  console.log('='.repeat(50))

  // Build inventory_id -> client_id lookup from billing_storage
  const invToClient = {}
  let cursor = null

  while (true) {
    let query = supabase
      .from('billing_storage')
      .select('id, inventory_id, client_id')
      .order('id', { ascending: true })
      .limit(1000)

    if (cursor) query = query.gt('id', cursor)

    const { data, error } = await query
    if (error || !data || data.length === 0) break

    for (const row of data) {
      if (row.inventory_id && row.client_id) {
        invToClient[row.inventory_id] = row.client_id
      }
      cursor = row.id
    }
    if (data.length < 1000) break
  }

  console.log('Inventory IDs from billing_storage:', Object.keys(invToClient).length)

  // Get ALL unattributed FC transactions (paginated)
  const fcTx = []
  let fcCursor = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, reference_id, additional_details')
      .eq('reference_type', 'FC')
      .is('client_id', null)
      .range(fcCursor, fcCursor + 999)
      .order('id')

    if (error) {
      console.error('Error fetching FC transactions:', error.message)
      break
    }
    if (!data || data.length === 0) break

    fcTx.push(...data)
    fcCursor += data.length
    if (data.length < 1000) break
  }

  console.log('Unattributed FC transactions:', fcTx?.length || 0)

  // Build updates - try reference_id first, then additional_details
  // FC reference_id format: {FC_ID}-{InventoryId}-{LocationType} (e.g., "183-20777279-Pallet")
  const fcUpdates = []
  const fcStats = { fromRefId: 0, fromDetails: 0, aggregate: 0, noMatch: 0 }

  for (const tx of fcTx || []) {
    const parts = tx.reference_id.split('-')

    // Try to extract InventoryId from reference_id (middle part)
    let invId = null
    if (parts.length >= 2) {
      invId = parts[1]
    }

    // Fallback to additional_details.InventoryId
    if (!invId || !invToClient[invId]) {
      invId = tx.additional_details?.InventoryId
    }

    if (invId && invToClient[invId]) {
      fcUpdates.push({ id: tx.id, client_id: invToClient[invId] })
      if (parts.length >= 2 && invToClient[parts[1]]) fcStats.fromRefId++
      else fcStats.fromDetails++
    } else if (parts.length === 1) {
      fcStats.aggregate++ // Aggregate warehouse fee (just FC ID, no inventory)
    } else {
      fcStats.noMatch++
    }
  }

  console.log('Attribution sources:')
  console.log(`  From reference_id: ${fcStats.fromRefId}`)
  console.log(`  From additional_details: ${fcStats.fromDetails}`)
  console.log(`  Aggregate fees (no inv): ${fcStats.aggregate}`)
  console.log(`  No match: ${fcStats.noMatch}`)
  console.log('Can attribute:', fcUpdates.length)

  if (!dryRun && fcUpdates.length > 0) {
    let updated = 0
    for (let i = 0; i < fcUpdates.length; i += BATCH_SIZE) {
      const batch = fcUpdates.slice(i, i + BATCH_SIZE)
      for (const upd of batch) {
        await supabase
          .from('transactions')
          .update({ client_id: upd.client_id })
          .eq('id', upd.id)
      }
      updated += batch.length
      process.stdout.write(`\r  Updated ${updated}/${fcUpdates.length}`)
    }
    console.log('\n  FC attribution complete!')
  }

  // =====================================================
  // 2. Returns Attribution via Returns API
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('2. RETURN ATTRIBUTION')
  console.log('='.repeat(50))

  // Build return_id -> client_id lookup from API
  // Returns API uses cursor-based pagination with { items: [...], next: ... } format
  const returnToClient = {}

  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log(`\nFetching returns for ${client.company_name}...`)

    let cursor = null
    let totalReturns = 0

    while (true) {
      let url = `${SHIPBOB_API}/return?Limit=250`
      if (cursor) url += `&cursor=${cursor}`

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${cred.api_token}` }
      })

      if (!resp.ok) {
        console.log('  Error:', resp.status)
        break
      }

      const data = await resp.json()
      const returns = data.items || []
      if (returns.length === 0) break

      for (const ret of returns) {
        if (ret.id) {
          returnToClient[ret.id] = client.id
        }
      }

      totalReturns += returns.length

      // Extract cursor from next URL if present
      if (data.next) {
        const nextUrl = new URL(data.next)
        cursor = nextUrl.searchParams.get('cursor')
      } else {
        break
      }
    }

    console.log(`  ${totalReturns} returns fetched`)
  }

  console.log('\nTotal return IDs mapped:', Object.keys(returnToClient).length)

  // Get unattributed Return transactions
  const { data: retTx } = await supabase
    .from('transactions')
    .select('id, reference_id')
    .eq('reference_type', 'Return')
    .is('client_id', null)

  console.log('Unattributed Return transactions:', retTx?.length || 0)

  // Build updates
  const retUpdates = []
  for (const tx of retTx || []) {
    const clientId = returnToClient[tx.reference_id]
    if (clientId) {
      retUpdates.push({ id: tx.id, client_id: clientId })
    }
  }

  console.log('Can attribute:', retUpdates.length)

  if (!dryRun && retUpdates.length > 0) {
    let updated = 0
    for (const upd of retUpdates) {
      await supabase
        .from('transactions')
        .update({ client_id: upd.client_id })
        .eq('id', upd.id)
      updated++
    }
    console.log(`  Return attribution complete: ${updated} updated`)
  }

  // =====================================================
  // 3. WRO/URO Attribution via Receiving API
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('3. WRO/URO (RECEIVING) ATTRIBUTION')
  console.log('='.repeat(50))

  // Build wro_id -> client_id lookup from API
  const wroToClient = {}

  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log(`\nFetching receiving orders for ${client.company_name}...`)

    let page = 1
    let totalWros = 0

    while (true) {
      const resp = await fetch(`${SHIPBOB_API}/receiving?Limit=250&Page=${page}`, {
        headers: { Authorization: `Bearer ${cred.api_token}` }
      })

      if (!resp.ok) {
        console.log('  Error:', resp.status)
        break
      }

      const wros = await resp.json()
      if (!wros || wros.length === 0) break

      for (const wro of wros) {
        if (wro.id) {
          wroToClient[wro.id] = client.id
        }
      }

      totalWros += wros.length
      if (wros.length < 250) break
      page++
    }

    console.log(`  ${totalWros} WROs fetched`)
  }

  console.log('\nTotal WRO IDs mapped:', Object.keys(wroToClient).length)

  // Get unattributed WRO/URO transactions
  const { data: wroTx } = await supabase
    .from('transactions')
    .select('id, reference_id, reference_type')
    .in('reference_type', ['WRO', 'URO'])
    .is('client_id', null)

  console.log('Unattributed WRO/URO transactions:', wroTx?.length || 0)

  // Build updates
  const wroUpdates = []
  for (const tx of wroTx || []) {
    const clientId = wroToClient[tx.reference_id]
    if (clientId) {
      wroUpdates.push({ id: tx.id, client_id: clientId })
    }
  }

  console.log('Can attribute:', wroUpdates.length)

  if (!dryRun && wroUpdates.length > 0) {
    let updated = 0
    for (const upd of wroUpdates) {
      await supabase
        .from('transactions')
        .update({ client_id: upd.client_id })
        .eq('id', upd.id)
      updated++
    }
    console.log(`  WRO/URO attribution complete: ${updated} updated`)
  }

  // =====================================================
  // 4. TicketNumber Attribution via Comment parsing
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('4. TICKETNUMBER ATTRIBUTION')
  console.log('='.repeat(50))

  // Build client name patterns for matching
  const clientPatterns = {}
  for (const client of clients || []) {
    const name = client.company_name.toLowerCase()
    // Add variations: "Methyl-Life" -> ["methyl", "methyllife", "methyl-life", "methyl life"]
    clientPatterns[name] = client.id
    clientPatterns[name.replace(/-/g, ' ')] = client.id
    clientPatterns[name.replace(/-/g, '')] = client.id
    clientPatterns[name.split(/[-\s]/)[0]] = client.id // first word
  }

  // Get unattributed TicketNumber transactions
  const { data: ticketTx } = await supabase
    .from('transactions')
    .select('id, additional_details')
    .eq('reference_type', 'TicketNumber')
    .is('client_id', null)

  console.log('Unattributed TicketNumber transactions:', ticketTx?.length || 0)

  // Build updates by parsing Comment for client name
  const ticketUpdates = []
  for (const tx of ticketTx || []) {
    const comment = (tx.additional_details?.Comment || '').toLowerCase()

    for (const [pattern, clientId] of Object.entries(clientPatterns)) {
      if (comment.includes(pattern)) {
        ticketUpdates.push({ id: tx.id, client_id: clientId })
        break
      }
    }
  }

  console.log('Can attribute:', ticketUpdates.length)

  if (!dryRun && ticketUpdates.length > 0) {
    let updated = 0
    for (const upd of ticketUpdates) {
      await supabase
        .from('transactions')
        .update({ client_id: upd.client_id })
        .eq('id', upd.id)
      updated++
    }
    console.log(`  TicketNumber attribution complete: ${updated} updated`)
  }

  // =====================================================
  // 5. Shipment Attribution via shipments table lookup
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('5. SHIPMENT ATTRIBUTION')
  console.log('='.repeat(50))

  // Get unattributed Shipment transactions
  const { data: shipTx } = await supabase
    .from('transactions')
    .select('id, reference_id')
    .eq('reference_type', 'Shipment')
    .is('client_id', null)

  console.log('Unattributed Shipment transactions:', shipTx?.length || 0)

  // Look up client_id from shipments table
  const shipUpdates = []
  for (const tx of shipTx || []) {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', parseInt(tx.reference_id))
      .single()

    if (shipment?.client_id) {
      shipUpdates.push({ id: tx.id, client_id: shipment.client_id })
    }
  }

  console.log('Can attribute:', shipUpdates.length)

  if (!dryRun && shipUpdates.length > 0) {
    let updated = 0
    for (const upd of shipUpdates) {
      await supabase
        .from('transactions')
        .update({ client_id: upd.client_id })
        .eq('id', upd.id)
      updated++
    }
    console.log(`  Shipment attribution complete: ${updated} updated`)
  }

  // =====================================================
  // 6. Default (Payments) → ShipBob Payments client
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('6. DEFAULT (PAYMENTS) ATTRIBUTION')
  console.log('='.repeat(50))

  // Get or create ShipBob Payments system client
  let { data: sbPayments } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'ShipBob Payments')
    .single()

  if (!sbPayments) {
    const { data: newClient } = await supabase
      .from('clients')
      .insert({ company_name: 'ShipBob Payments', is_active: false })
      .select()
      .single()
    sbPayments = newClient
    console.log('Created ShipBob Payments client:', sbPayments?.id)
  } else {
    console.log('Using existing ShipBob Payments client:', sbPayments.id)
  }

  // Get unattributed Default transactions
  const { data: defaultTx } = await supabase
    .from('transactions')
    .select('id')
    .eq('reference_type', 'Default')
    .is('client_id', null)

  console.log('Unattributed Default transactions:', defaultTx?.length || 0)

  if (!dryRun && defaultTx?.length > 0 && sbPayments) {
    let updated = 0
    for (const tx of defaultTx) {
      await supabase
        .from('transactions')
        .update({ client_id: sbPayments.id })
        .eq('id', tx.id)
      updated++
    }
    console.log(`  Attributed to ShipBob Payments: ${updated}`)
  }

  // =====================================================
  // 7. Invoice-based fallback for remaining unattributed
  // =====================================================
  console.log('\n' + '='.repeat(50))
  console.log('7. INVOICE-BASED FALLBACK')
  console.log('='.repeat(50))

  // Get remaining unattributed transactions
  const { data: remainingTx } = await supabase
    .from('transactions')
    .select('id, invoice_id_sb')
    .is('client_id', null)

  console.log('Remaining unattributed:', remainingTx?.length || 0)

  if (remainingTx?.length > 0) {
    // Group by invoice
    const byInvoice = {}
    for (const tx of remainingTx) {
      const inv = tx.invoice_id_sb
      if (!byInvoice[inv]) byInvoice[inv] = []
      byInvoice[inv].push(tx)
    }

    const invoiceUpdates = []
    for (const [invId, txs] of Object.entries(byInvoice)) {
      // Find attributed transactions on same invoice
      const { data: attributed } = await supabase
        .from('transactions')
        .select('client_id')
        .eq('invoice_id_sb', parseInt(invId))
        .not('client_id', 'is', null)
        .limit(1)

      if (attributed?.length > 0) {
        const clientId = attributed[0].client_id
        for (const tx of txs) {
          invoiceUpdates.push({ id: tx.id, client_id: clientId })
        }
      }
    }

    console.log('Can attribute via invoice:', invoiceUpdates.length)

    if (!dryRun && invoiceUpdates.length > 0) {
      let updated = 0
      for (const upd of invoiceUpdates) {
        await supabase
          .from('transactions')
          .update({ client_id: upd.client_id })
          .eq('id', upd.id)
        updated++
      }
      console.log(`  Invoice-based attribution complete: ${updated}`)
    }
  }

  // =====================================================
  // SUMMARY
  // =====================================================
  console.log('\n' + '='.repeat(70))
  console.log('FINAL ATTRIBUTION STATUS')
  console.log('='.repeat(70))

  // Get final counts
  const { count: totalTx } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  const { count: attributed } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('client_id', 'is', null)

  const { count: unattributed } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log(`\nTotal transactions: ${totalTx}`)
  console.log(`Attributed: ${attributed}`)
  console.log(`Unattributed: ${unattributed}`)
  console.log(`Attribution rate: ${((attributed / totalTx) * 100).toFixed(1)}%`)

  // Breakdown of remaining unattributed
  const { data: remaining } = await supabase
    .from('transactions')
    .select('reference_type')
    .is('client_id', null)

  const byType = {}
  for (const tx of remaining || []) {
    byType[tx.reference_type] = (byType[tx.reference_type] || 0) + 1
  }

  console.log('\nRemaining unattributed by type:')
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }
}

main().catch(console.error)
