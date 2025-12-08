/**
 * Import Historical Invoices (Full Import with Per-Transaction Updates)
 *
 * This script:
 * 1. Reads historical XLSX files from reference/invoices-historical/
 * 2. Creates invoices_jetpack records with totals
 * 3. Updates EACH transaction with billed amounts from XLS
 * 4. Calculates markup_percentage from (billed_amount / cost)
 * 5. Uploads PDF/XLSX files to Supabase Storage
 *
 * Usage: node scripts/import-historical-invoices.js [--dry-run] [--verbose]
 *
 * XLS Column Mappings:
 * - Shipping: OrderID → reference_id, "Original Invoice" → billed_amount
 * - Additional Fees: "Reference ID" → reference_id, "Invoice Amount" → billed_amount
 * - Returns: "Return ID" → reference_id, "Invoice" → billed_amount
 * - Receiving: "WRO Number" → reference_id, "Invoice" → billed_amount
 * - Credits: "Reference ID" → reference_id, "Credit Amount" → billed_amount
 * - Storage: "Inventory ID" → reference_id (complex matching), "Invoice" → billed_amount
 *
 * Transaction Field Updates:
 * - SHIPMENTS: base_charge, surcharge, total_charge, insurance_charge, billed_amount
 * - NON-SHIPMENTS: billed_amount only (breakdown columns stay NULL)
 * - ALL: markup_percentage, markup_applied, jetpack_invoice_id, invoiced_status_jp
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')
const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

// Map short codes to client info
const CLIENT_MAP = {
  'HS': { shortCode: 'HS', name: 'Henson Shaving' },
  'ML': { shortCode: 'ML', name: 'Methyl-Life' }
}

/**
 * Parse invoice number from filename
 */
function parseFilename(filename) {
  // Try standard 6-digit date format first
  let match = filename.match(/INVOICE-(?:DETAILS|SUMMARY)-JP([A-Z]{2})-(\d{4})-(\d{6})\.(?:xlsx|pdf)/i)

  // If that fails, try 7-digit format (typo)
  if (!match) {
    match = filename.match(/INVOICE-(?:DETAILS|SUMMARY)-JP([A-Z]{2})-(\d{4})-(\d{7})\.(?:xlsx|pdf)/i)
    if (match) {
      const [, shortCode, seqNum, dateStr] = match
      const fixedDateStr = dateStr.slice(0, 2) + dateStr.slice(3)
      const month = parseInt(fixedDateStr.slice(0, 2), 10)
      const day = parseInt(fixedDateStr.slice(2, 4), 10)
      const year = 2000 + parseInt(fixedDateStr.slice(4, 6), 10)
      const invoiceDate = new Date(year, month - 1, day)

      return {
        shortCode,
        sequenceNumber: parseInt(seqNum, 10),
        invoiceDate,
        invoiceNumber: `JP${shortCode}-${seqNum}-${fixedDateStr}`,
        clientKey: shortCode
      }
    }
    return null
  }

  const [, shortCode, seqNum, dateStr] = match
  const month = parseInt(dateStr.slice(0, 2), 10)
  const day = parseInt(dateStr.slice(2, 4), 10)
  const year = 2000 + parseInt(dateStr.slice(4, 6), 10)
  const invoiceDate = new Date(year, month - 1, day)

  return {
    shortCode,
    sequenceNumber: parseInt(seqNum, 10),
    invoiceDate,
    invoiceNumber: `JP${shortCode}-${seqNum}-${dateStr}`,
    clientKey: shortCode
  }
}

/**
 * Helper to find a column by multiple possible names
 */
function findColumnIndex(headers, possibleNames) {
  for (const name of possibleNames) {
    const idx = headers.findIndex(h => h === name)
    if (idx !== -1) return idx
  }
  return -1
}

/**
 * Extract all transactions from XLSX file
 *
 * Column variations handled:
 * - Shipping/Shipments: OrderID or Store OrderID; Original Invoice or Invoice Amount
 * - Additional Fees/Services: Reference ID; Invoice Amount
 * - Returns: Return ID; Invoice
 * - Receiving (old): WRO Number; Invoice
 * - Receiving (new): Reference ID; Invoice Amount
 * - Credits: Reference ID; Credit Amount
 * - Storage: Inventory ID; Invoice
 */
function extractTransactionsFromXLSX(filePath) {
  const workbook = XLSX.readFile(filePath)
  const transactions = {
    shipping: [],
    additionalServices: [],
    returns: [],
    receiving: [],
    credits: [],
    storage: [],
    totals: {
      shipping: 0,
      additionalServices: 0,
      returns: 0,
      receiving: 0,
      credits: 0,
      storage: 0,
      grandTotal: 0
    },
    parseErrors: []  // Track parsing issues for debugging
  }

  // Excel serial number to JS Date
  const excelToDate = (serial) => {
    if (typeof serial !== 'number') return null
    const utc_days = Math.floor(serial - 25569)
    return new Date(utc_days * 86400 * 1000)
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    if (data.length < 2) continue

    const headers = data[0]
    const normalizedName = sheetName.toLowerCase()

    // Process each data row (skip header and total rows)
    for (let i = 1; i < data.length; i++) {
      const row = data[i]
      if (!row || row[0] === 'Total' || row.length === 0) continue

      // Create object from row
      const rowObj = {}
      headers.forEach((h, idx) => {
        if (h) rowObj[h] = row[idx]
      })

      if (normalizedName === 'shipping' || normalizedName === 'shipments') {
        // Try multiple column names for ID and amount
        // ID: OrderID > Store OrderID
        const orderIdIdx = findColumnIndex(headers, ['OrderID', 'Store OrderID'])
        // Amount: Original Invoice > Invoice Amount
        const billedIdx = findColumnIndex(headers, ['Original Invoice', 'Invoice Amount'])

        if (orderIdIdx === -1) {
          if (i === 1) transactions.parseErrors.push(`${sheetName}: No OrderID column found. Headers: ${headers.filter(h => h?.toLowerCase().includes('order') || h?.toLowerCase().includes('id')).join(', ')}`)
          continue
        }
        if (billedIdx === -1) {
          if (i === 1) transactions.parseErrors.push(`${sheetName}: No billed amount column found. Headers: ${headers.filter(h => h?.toLowerCase().includes('invoice') || h?.toLowerCase().includes('amount')).join(', ')}`)
          continue
        }

        const orderId = String(row[orderIdIdx] || '')
        const billedAmount = parseFloat(row[billedIdx]) || 0

        if (orderId && billedAmount !== 0) {
          transactions.shipping.push({
            referenceId: orderId,
            billedAmount,
            transactionDate: excelToDate(rowObj['Transaction Date'] || rowObj['Label Generation Timestamp'])
          })
          transactions.totals.shipping += billedAmount
        }
      }
      else if (normalizedName === 'additional fees' || normalizedName === 'additional services') {
        const referenceId = String(rowObj['Reference ID'] || '')
        const billedAmount = parseFloat(rowObj['Invoice Amount']) || 0
        const feeType = rowObj['Fee Type'] || ''

        if (referenceId && billedAmount !== 0) {
          transactions.additionalServices.push({
            referenceId,
            billedAmount,
            feeType,
            transactionDate: excelToDate(rowObj['Transaction Date'])
          })
          transactions.totals.additionalServices += billedAmount
        }
      }
      else if (normalizedName === 'returns') {
        const referenceId = String(rowObj['Return ID'] || '')
        const billedAmount = parseFloat(rowObj['Invoice']) || 0
        const transactionType = rowObj['Transaction Type'] || ''

        if (referenceId && billedAmount !== 0) {
          transactions.returns.push({
            referenceId,
            billedAmount,
            transactionType,
            transactionDate: excelToDate(rowObj['Return Creation Date'])
          })
          transactions.totals.returns += billedAmount
        }
      }
      else if (normalizedName === 'receiving') {
        // Two formats:
        // Old format (WRO Number + Invoice): WRO Number is reference, Invoice is amount
        // New format (Reference ID + Invoice Amount): Reference ID is reference, Invoice Amount is amount
        let referenceId = ''
        let billedAmount = 0

        // Try old format first (WRO Number)
        if (rowObj['WRO Number']) {
          referenceId = String(rowObj['WRO Number'])
          billedAmount = parseFloat(rowObj['Invoice']) || 0
        }
        // Try new format (Reference ID)
        else if (rowObj['Reference ID']) {
          referenceId = String(rowObj['Reference ID'])
          billedAmount = parseFloat(rowObj['Invoice Amount']) || 0
        }

        if (referenceId && billedAmount !== 0) {
          transactions.receiving.push({
            referenceId,
            billedAmount,
            transactionDate: excelToDate(rowObj['Transaction Date'])
          })
          transactions.totals.receiving += billedAmount
        }
      }
      else if (normalizedName === 'credits') {
        const referenceId = String(rowObj['Reference ID'] || '')
        const billedAmount = parseFloat(rowObj['Credit Amount']) || 0
        const reason = rowObj['Credit Reason'] || ''

        if (referenceId && billedAmount !== 0) {
          transactions.credits.push({
            referenceId,
            billedAmount,
            reason,
            transactionDate: excelToDate(rowObj['Transaction Date'])
          })
          transactions.totals.credits += billedAmount
        }
      }
      else if (normalizedName === 'storage') {
        // Storage is complex - uses Inventory ID + FC + date for matching
        const inventoryId = String(rowObj['Inventory ID'] || '')
        const billedAmount = parseFloat(rowObj['Invoice']) || 0
        const fcName = rowObj['FC Name'] || ''
        const locationType = rowObj['Location Type'] || ''

        if (inventoryId && billedAmount !== 0) {
          transactions.storage.push({
            inventoryId,
            billedAmount,
            fcName,
            locationType,
            transactionDate: excelToDate(rowObj['Transaction Date'] || rowObj['ChargeStartdate'])
          })
          transactions.totals.storage += billedAmount
        }
      }
    }
  }

  transactions.totals.grandTotal =
    transactions.totals.shipping +
    transactions.totals.additionalServices +
    transactions.totals.returns +
    transactions.totals.receiving +
    transactions.totals.credits +
    transactions.totals.storage

  return transactions
}

/**
 * Extract period from transaction dates in XLSX
 */
function extractPeriodFromXLSX(filePath) {
  const workbook = XLSX.readFile(filePath)
  const dates = []

  const excelToDate = (serial) => {
    if (typeof serial !== 'number') return null
    const utc_days = Math.floor(serial - 25569)
    return new Date(utc_days * 86400 * 1000)
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    if (data.length < 2) continue

    const headers = data[0]
    const dateColIdx = headers.findIndex(h =>
      h === 'Transaction Date' || h === 'Label Generation Timestamp' || h === 'Return Creation Date'
    )
    if (dateColIdx === -1) continue

    for (let i = 1; i < data.length; i++) {
      const row = data[i]
      if (row[0] === 'Total') break
      const dateVal = row[dateColIdx]
      const date = excelToDate(dateVal)
      if (date && !isNaN(date.getTime())) {
        dates.push(date)
      }
    }
  }

  if (dates.length === 0) {
    return { periodStart: null, periodEnd: null }
  }

  dates.sort((a, b) => a.getTime() - b.getTime())
  return {
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1]
  }
}

/**
 * Get client ID from short code
 */
async function getClientId(shortCode) {
  const fullShortCode = shortCode === 'HS' ? 'HS' : 'ML'

  const { data, error } = await supabase
    .from('clients')
    .select('id, company_name, short_code')
    .eq('short_code', fullShortCode)
    .single()

  if (error) {
    console.error(`Error finding client for ${shortCode}:`, error)
    return null
  }
  return data
}

/**
 * Batch an array into chunks of specified size
 */
function chunkArray(array, chunkSize) {
  const chunks = []
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize))
  }
  return chunks
}

// Supabase has a limit on IN clause size (around 500-1000 items for safe queries)
const BATCH_SIZE = 500

/**
 * Update transactions with billed amounts from XLS
 */
async function updateTransactions(clientId, invoiceId, transactions) {
  const stats = {
    shipping: { matched: 0, notFound: 0, updated: 0, errors: [] },
    additionalServices: { matched: 0, notFound: 0, updated: 0, errors: [] },
    returns: { matched: 0, notFound: 0, updated: 0, errors: [] },
    receiving: { matched: 0, notFound: 0, updated: 0, errors: [] },
    credits: { matched: 0, notFound: 0, updated: 0, errors: [] },
    storage: { matched: 0, notFound: 0, updated: 0, errors: [] }
  }

  // Helper function to prepare update data for a transaction (doesn't execute)
  const prepareUpdateData = (tx, billedAmount, category) => {
    const cost = tx.cost || 0
    let markupPercentage = 0
    let markupApplied = 0

    if (cost !== 0) {
      markupApplied = billedAmount - cost
      markupPercentage = cost !== 0 ? (billedAmount / cost) - 1 : 0
    }

    const updateData = {
      billed_amount: billedAmount,
      markup_applied: markupApplied,
      markup_percentage: markupPercentage,
      invoice_id_jp: invoiceId,
      invoiced_status_jp: true
    }

    // For shipments, also set base_charge and total_charge if we have base_cost
    if (category === 'shipping' && tx.base_cost != null) {
      updateData.base_charge = tx.base_cost * (1 + markupPercentage)
      updateData.total_charge = updateData.base_charge + (tx.surcharge || 0)
      if (tx.insurance_cost) {
        updateData.insurance_charge = tx.insurance_cost * (1 + markupPercentage)
      }
    }

    return { id: tx.id, updateData, markupPercentage }
  }

  // Helper function to execute batch updates in parallel
  const executeBatchUpdates = async (updates, category) => {
    const PARALLEL_SIZE = 50  // Number of concurrent updates
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < updates.length; i += PARALLEL_SIZE) {
      const batch = updates.slice(i, i + PARALLEL_SIZE)

      const results = await Promise.all(batch.map(async ({ id, updateData }) => {
        const { error } = await supabase
          .from('transactions')
          .update(updateData)
          .eq('id', id)

        if (error) {
          errorCount++
          if (errorCount <= 3) {
            console.log(`    [ERROR] Update failed for ${id}: ${error.message}`)
          }
          stats[category].errors.push(`Update error: ${error.message}`)
          return false
        }
        return true
      }))

      successCount += results.filter(r => r).length
    }

    if (errorCount > 3) {
      console.log(`    [ERROR] ... and ${errorCount - 3} more errors`)
    }
    return successCount
  }

  // Helper for dry-run (compatibility)
  const updateTransaction = async (tx, billedAmount, category) => {
    const { id, updateData, markupPercentage } = prepareUpdateData(tx, billedAmount, category)

    if (DRY_RUN) {
      if (VERBOSE) {
        console.log(`    [DRY RUN] Would update tx ${id}: billed=$${billedAmount.toFixed(2)}, markup=${(markupPercentage * 100).toFixed(1)}%`)
      }
      return true
    }

    const { error } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', id)

    if (error) {
      stats[category].errors.push(`Update error for ${tx.reference_id}: ${error.message}`)
      return false
    }
    return true
  }

  // Process Shipping transactions (with batching for large datasets)
  if (transactions.shipping.length > 0) {
    const referenceIds = transactions.shipping.map(t => t.referenceId)
    const idBatches = chunkArray(referenceIds, BATCH_SIZE)

    // Fetch all matching shipping transactions in batches
    const txMap = new Map()
    for (const batch of idBatches) {
      const { data: dbTxs, error } = await supabase
        .from('transactions')
        .select('id, reference_id, cost, base_cost, surcharge, insurance_cost')
        .eq('client_id', clientId)
        .eq('reference_type', 'Shipment')
        .eq('transaction_fee', 'Shipping')
        .in('reference_id', batch)

      if (error) {
        stats.shipping.errors.push(`Query error: ${error.message}`)
        break
      }

      // Add results to map
      dbTxs.forEach(tx => txMap.set(String(tx.reference_id), tx))
    }

    // Match XLS rows to DB transactions and collect updates
    const shippingUpdates = []
    for (const xlsTx of transactions.shipping) {
      const dbTx = txMap.get(xlsTx.referenceId)
      if (dbTx) {
        stats.shipping.matched++
        if (DRY_RUN) {
          const success = await updateTransaction(dbTx, xlsTx.billedAmount, 'shipping')
          if (success) stats.shipping.updated++
        } else {
          shippingUpdates.push(prepareUpdateData(dbTx, xlsTx.billedAmount, 'shipping'))
        }
      } else {
        stats.shipping.notFound++
      }
    }

    // Execute parallel batch updates
    if (!DRY_RUN && shippingUpdates.length > 0) {
      console.log(`    [DEBUG] Executing ${shippingUpdates.length} shipping updates...`)
      stats.shipping.updated = await executeBatchUpdates(shippingUpdates, 'shipping')
      console.log(`    [DEBUG] Shipping updates completed: ${stats.shipping.updated}`)
    }
  }

  // Process Additional Services (with batching)
  if (transactions.additionalServices.length > 0) {
    const referenceIds = transactions.additionalServices.map(t => t.referenceId)
    const idBatches = chunkArray(referenceIds, BATCH_SIZE)

    // Group by reference_id for matching
    const txMap = new Map()
    for (const batch of idBatches) {
      const { data: dbTxs, error } = await supabase
        .from('transactions')
        .select('id, reference_id, cost, transaction_fee')
        .eq('client_id', clientId)
        .eq('reference_type', 'Shipment')
        .neq('transaction_fee', 'Shipping')
        .in('reference_id', batch)

      if (error) {
        stats.additionalServices.errors.push(`Query error: ${error.message}`)
        break
      }

      for (const tx of dbTxs) {
        if (!txMap.has(String(tx.reference_id))) {
          txMap.set(String(tx.reference_id), [])
        }
        txMap.get(String(tx.reference_id)).push(tx)
      }
    }

    const addlUpdates = []
    for (const xlsTx of transactions.additionalServices) {
      const dbTxs = txMap.get(xlsTx.referenceId)
      if (dbTxs && dbTxs.length > 0) {
        // Try to match by fee type, or take first if only one
        let matched = dbTxs.find(t => t.transaction_fee === xlsTx.feeType) || dbTxs[0]
        stats.additionalServices.matched++
        if (DRY_RUN) {
          const success = await updateTransaction(matched, xlsTx.billedAmount, 'additionalServices')
          if (success) stats.additionalServices.updated++
        } else {
          addlUpdates.push(prepareUpdateData(matched, xlsTx.billedAmount, 'additionalServices'))
        }
      } else {
        stats.additionalServices.notFound++
      }
    }

    // Execute parallel batch updates
    if (!DRY_RUN && addlUpdates.length > 0) {
      stats.additionalServices.updated = await executeBatchUpdates(addlUpdates, 'additionalServices')
    }
  }

  // Process Returns
  if (transactions.returns.length > 0) {
    const referenceIds = transactions.returns.map(t => t.referenceId)

    const { data: dbTxs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'Return')
      .in('reference_id', referenceIds)

    if (error) {
      stats.returns.errors.push(`Query error: ${error.message}`)
    } else {
      const txMap = new Map(dbTxs.map(tx => [String(tx.reference_id), tx]))

      for (const xlsTx of transactions.returns) {
        const dbTx = txMap.get(xlsTx.referenceId)
        if (dbTx) {
          stats.returns.matched++
          const success = await updateTransaction(dbTx, xlsTx.billedAmount, 'returns')
          if (success) stats.returns.updated++
        } else {
          stats.returns.notFound++
        }
      }
    }
  }

  // Process Receiving (WRO)
  if (transactions.receiving.length > 0) {
    const referenceIds = transactions.receiving.map(t => t.referenceId)

    const { data: dbTxs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'WRO')
      .in('reference_id', referenceIds)

    if (error) {
      stats.receiving.errors.push(`Query error: ${error.message}`)
    } else {
      const txMap = new Map(dbTxs.map(tx => [String(tx.reference_id), tx]))

      for (const xlsTx of transactions.receiving) {
        const dbTx = txMap.get(xlsTx.referenceId)
        if (dbTx) {
          stats.receiving.matched++
          const success = await updateTransaction(dbTx, xlsTx.billedAmount, 'receiving')
          if (success) stats.receiving.updated++
        } else {
          stats.receiving.notFound++
        }
      }
    }
  }

  // Process Credits
  if (transactions.credits.length > 0) {
    const referenceIds = transactions.credits.map(t => t.referenceId)

    const { data: dbTxs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, cost')
      .eq('client_id', clientId)
      .eq('transaction_fee', 'Credit')
      .in('reference_id', referenceIds)

    if (error) {
      stats.credits.errors.push(`Query error: ${error.message}`)
    } else {
      const txMap = new Map(dbTxs.map(tx => [String(tx.reference_id), tx]))

      for (const xlsTx of transactions.credits) {
        const dbTx = txMap.get(xlsTx.referenceId)
        if (dbTx) {
          stats.credits.matched++
          const success = await updateTransaction(dbTx, xlsTx.billedAmount, 'credits')
          if (success) stats.credits.updated++
        } else {
          stats.credits.notFound++
        }
      }
    }
  }

  // Process Storage - match by inventory_id + location_type
  // DB reference_id format: {FC_ID}-{InventoryId}-{LocationType}
  // XLS has: Inventory ID, Location Type, FC Name
  if (transactions.storage.length > 0) {
    // Build a map of composite key -> XLS billed amount
    // Key format: {InventoryId}-{LocationType}
    const xlsStorageMap = new Map()

    // Normalize location types (DB uses Pallet/Shelf, XLS may use HalfPallet)
    const normalizeLocationType = (type) => {
      if (!type) return ''
      const upper = type.toUpperCase()
      if (upper.includes('PALLET')) return 'Pallet'
      if (upper.includes('SHELF')) return 'Shelf'
      return type
    }

    // Aggregate XLS amounts by InventoryId + LocationType
    // (XLS has per-day entries, we need total per inventory-location)
    for (const xlsTx of transactions.storage) {
      const key = `${xlsTx.inventoryId}-${normalizeLocationType(xlsTx.locationType)}`
      if (!xlsStorageMap.has(key)) {
        xlsStorageMap.set(key, { total: 0, count: 0 })
      }
      const entry = xlsStorageMap.get(key)
      entry.total += xlsTx.billedAmount
      entry.count++
    }

    if (VERBOSE) {
      console.log(`    Storage: ${transactions.storage.length} XLS rows → ${xlsStorageMap.size} unique inventory-location combos`)
    }

    // Fetch all FC (storage) transactions for this client with batching
    const { data: dbStorageTxs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, cost, additional_details')
      .eq('client_id', clientId)
      .eq('reference_type', 'FC')

    if (error) {
      stats.storage.errors.push(`Query error: ${error.message}`)
    } else {
      // Build DB map: {InventoryId}-{NormalizedLocationType} -> tx
      const dbStorageMap = new Map()
      for (const tx of dbStorageTxs) {
        // Parse reference_id: {FC_ID}-{InventoryId}-{LocationType}
        const parts = tx.reference_id.split('-')
        if (parts.length >= 3) {
          const inventoryId = parts[1]
          const locationType = normalizeLocationType(parts.slice(2).join('-'))
          const key = `${inventoryId}-${locationType}`

          if (!dbStorageMap.has(key)) {
            dbStorageMap.set(key, { txs: [], totalCost: 0 })
          }
          const entry = dbStorageMap.get(key)
          entry.txs.push(tx)
          entry.totalCost += tx.cost || 0
        }
      }

      if (VERBOSE) {
        console.log(`    Storage: ${dbStorageTxs.length} DB transactions → ${dbStorageMap.size} unique inventory-location combos`)
      }

      // Match XLS to DB
      for (const [key, xlsData] of xlsStorageMap) {
        const dbData = dbStorageMap.get(key)
        if (dbData && dbData.txs.length > 0) {
          stats.storage.matched += xlsData.count

          // Calculate markup based on totals
          const markupPercentage = dbData.totalCost !== 0 ? (xlsData.total / dbData.totalCost) - 1 : 0
          const markupApplied = xlsData.total - dbData.totalCost

          // Update all DB transactions for this inventory-location
          for (const tx of dbData.txs) {
            const billedAmount = tx.cost * (1 + markupPercentage)

            if (DRY_RUN) {
              stats.storage.updated++
              continue
            }

            const { error: updateError } = await supabase
              .from('transactions')
              .update({
                billed_amount: billedAmount,
                markup_applied: tx.cost * markupPercentage,
                markup_percentage: markupPercentage,
                invoice_id_jp: invoiceId,
                invoiced_status_jp: true
              })
              .eq('id', tx.id)

            if (updateError) {
              stats.storage.errors.push(`Update error for ${tx.reference_id}: ${updateError.message}`)
            } else {
              stats.storage.updated++
            }
          }
        } else {
          stats.storage.notFound += xlsData.count
        }
      }
    }
  }

  return stats
}

/**
 * Upload PDF to Supabase Storage
 */
async function uploadPDF(clientId, invoiceNumber, pdfPath) {
  if (!fs.existsSync(pdfPath)) {
    return null
  }

  const pdfBuffer = fs.readFileSync(pdfPath)
  const storagePath = `${clientId}/${invoiceNumber}/${invoiceNumber}.pdf`

  if (DRY_RUN) return storagePath

  const { error } = await supabase.storage
    .from('invoices')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    })

  if (error) {
    console.error(`    Error uploading PDF:`, error)
    return null
  }

  return storagePath
}

/**
 * Upload XLSX to Supabase Storage
 */
async function uploadXLSX(clientId, invoiceNumber, xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    return null
  }

  const xlsxBuffer = fs.readFileSync(xlsxPath)
  const storagePath = `${clientId}/${invoiceNumber}/${invoiceNumber}-details.xlsx`

  if (DRY_RUN) return storagePath

  const { error } = await supabase.storage
    .from('invoices')
    .upload(storagePath, xlsxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true
    })

  if (error) {
    console.error(`    Error uploading XLSX:`, error)
    return null
  }

  return storagePath
}

/**
 * Main import function
 */
async function main() {
  console.log('='.repeat(70))
  console.log('IMPORT HISTORICAL INVOICES (FULL PER-TRANSACTION IMPORT)')
  console.log('='.repeat(70))
  if (DRY_RUN) console.log('\n*** DRY RUN MODE - No changes will be made ***\n')

  // Find all XLSX files
  const files = fs.readdirSync(HISTORICAL_DIR)
    .filter(f => f.startsWith('INVOICE-DETAILS-') && f.endsWith('.xlsx'))
    .sort()

  console.log(`\nFound ${files.length} invoice files to import\n`)

  const results = {
    imported: [],
    skipped: [],
    errors: [],
    txStats: {
      shipping: { matched: 0, notFound: 0, updated: 0 },
      additionalServices: { matched: 0, notFound: 0, updated: 0 },
      returns: { matched: 0, notFound: 0, updated: 0 },
      receiving: { matched: 0, notFound: 0, updated: 0 },
      credits: { matched: 0, notFound: 0, updated: 0 },
      storage: { matched: 0, notFound: 0, updated: 0 }
    }
  }

  for (const filename of files) {
    const info = parseFilename(filename)
    if (!info) {
      results.errors.push({ filename, error: 'Could not parse filename' })
      continue
    }

    console.log(`\nProcessing: ${info.invoiceNumber}`)

    // Get client
    const client = await getClientId(info.clientKey)
    if (!client) {
      results.errors.push({ filename, error: `Client not found for ${info.clientKey}` })
      continue
    }

    // Check if already imported
    const { data: existing } = await supabase
      .from('invoices_jetpack')
      .select('id, invoice_number')
      .eq('invoice_number', info.invoiceNumber)
      .single()

    if (existing) {
      console.log(`  Already exists, skipping invoice creation`)
      // Still process transactions if needed
    }

    // Extract all transactions from XLSX
    const xlsxPath = path.join(HISTORICAL_DIR, filename)
    const transactions = extractTransactionsFromXLSX(xlsxPath)
    const period = extractPeriodFromXLSX(xlsxPath)

    console.log(`  Client: ${client.company_name}`)
    console.log(`  Invoice Date: ${info.invoiceDate.toISOString().split('T')[0]}`)
    console.log(`  Period: ${period.periodStart?.toISOString().split('T')[0] || 'N/A'} to ${period.periodEnd?.toISOString().split('T')[0] || 'N/A'}`)
    console.log(`  Transactions:`)
    console.log(`    Shipping:            ${transactions.shipping.length} rows, $${transactions.totals.shipping.toFixed(2)}`)
    console.log(`    Additional Services: ${transactions.additionalServices.length} rows, $${transactions.totals.additionalServices.toFixed(2)}`)
    console.log(`    Returns:             ${transactions.returns.length} rows, $${transactions.totals.returns.toFixed(2)}`)
    console.log(`    Receiving:           ${transactions.receiving.length} rows, $${transactions.totals.receiving.toFixed(2)}`)
    console.log(`    Credits:             ${transactions.credits.length} rows, $${transactions.totals.credits.toFixed(2)}`)

    // Show any parsing errors
    if (transactions.parseErrors && transactions.parseErrors.length > 0) {
      console.log(`  ⚠️  Parse Errors:`)
      transactions.parseErrors.forEach(e => console.log(`    - ${e}`))
    }
    console.log(`    Storage:             ${transactions.storage.length} rows, $${transactions.totals.storage.toFixed(2)}`)
    console.log(`    GRAND TOTAL:         $${transactions.totals.grandTotal.toFixed(2)}`)

    // Create invoice record FIRST to get UUID (if not exists and not dry-run)
    let invoiceId = null
    if (!existing && !DRY_RUN) {
      const formatDate = (d) => d ? d.toISOString().split('T')[0] : null

      const insertData = {
        client_id: client.id,
        invoice_number: info.invoiceNumber,
        invoice_date: formatDate(info.invoiceDate),
        period_start: formatDate(period.periodStart) || formatDate(info.invoiceDate),
        period_end: formatDate(period.periodEnd) || formatDate(info.invoiceDate),
        subtotal: transactions.totals.grandTotal,
        total_markup: 0, // Unknown for imported
        total_amount: transactions.totals.grandTotal,
        status: 'approved',
        generated_at: new Date().toISOString(),
      }

      const { data: invoice, error: insertError } = await supabase
        .from('invoices_jetpack')
        .insert(insertData)
        .select()
        .single()

      if (insertError) {
        console.error(`  Error creating invoice:`, insertError)
        results.errors.push({ filename, error: insertError.message })
        continue
      }

      invoiceId = invoice.id
      console.log(`  Created invoice record: ${invoiceId}`)
    } else if (existing) {
      invoiceId = existing.id
      console.log(`  Using existing invoice: ${invoiceId}`)
    }

    // Update transactions with the invoice UUID
    console.log(`  Updating transactions...`)
    const txStats = await updateTransactions(client.id, invoiceId, transactions)

    // Aggregate stats
    for (const cat of ['shipping', 'additionalServices', 'returns', 'receiving', 'credits', 'storage']) {
      results.txStats[cat].matched += txStats[cat].matched
      results.txStats[cat].notFound += txStats[cat].notFound
      results.txStats[cat].updated += txStats[cat].updated
    }

    console.log(`    Shipping:     ${txStats.shipping.matched} matched, ${txStats.shipping.updated} updated, ${txStats.shipping.notFound} not found`)
    console.log(`    Add'l Svc:    ${txStats.additionalServices.matched} matched, ${txStats.additionalServices.updated} updated, ${txStats.additionalServices.notFound} not found`)
    console.log(`    Returns:      ${txStats.returns.matched} matched, ${txStats.returns.updated} updated, ${txStats.returns.notFound} not found`)
    console.log(`    Receiving:    ${txStats.receiving.matched} matched, ${txStats.receiving.updated} updated, ${txStats.receiving.notFound} not found`)
    console.log(`    Credits:      ${txStats.credits.matched} matched, ${txStats.credits.updated} updated, ${txStats.credits.notFound} not found`)
    console.log(`    Storage:      ${txStats.storage.matched} matched, ${txStats.storage.updated} updated, ${txStats.storage.notFound} not found`)

    // Upload files (if invoice was created)
    if (invoiceId && !DRY_RUN) {
      const pdfFilename = filename.replace('DETAILS', 'SUMMARY').replace('.xlsx', '.pdf')
      const pdfPath = path.join(HISTORICAL_DIR, pdfFilename)

      await uploadPDF(client.id, info.invoiceNumber, pdfPath)
      await uploadXLSX(client.id, info.invoiceNumber, xlsxPath)
    }

    results.imported.push({
      invoiceNumber: info.invoiceNumber,
      client: client.company_name,
      total: transactions.totals.grandTotal,
      txMatched: txStats.shipping.matched + txStats.additionalServices.matched +
                 txStats.returns.matched + txStats.receiving.matched + txStats.credits.matched,
      txUpdated: txStats.shipping.updated + txStats.additionalServices.updated +
                 txStats.returns.updated + txStats.receiving.updated + txStats.credits.updated
    })

    console.log(`  Import complete`)
  }

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('IMPORT SUMMARY')
  console.log('='.repeat(70))
  console.log(`Total files: ${files.length}`)
  console.log(`Imported: ${results.imported.length}`)
  console.log(`Skipped: ${results.skipped.length}`)
  console.log(`Errors: ${results.errors.length}`)

  console.log('\nTransaction Stats:')
  console.log('| Category            | Matched | Updated | Not Found |')
  console.log('|---------------------|---------|---------|-----------|')
  for (const cat of ['shipping', 'additionalServices', 'returns', 'receiving', 'credits', 'storage']) {
    const s = results.txStats[cat]
    const label = cat.padEnd(19)
    console.log(`| ${label} | ${String(s.matched).padStart(7)} | ${String(s.updated).padStart(7)} | ${String(s.notFound).padStart(9)} |`)
  }

  if (results.errors.length > 0) {
    console.log('\nErrors:')
    results.errors.forEach(e => console.log(`  ${e.filename}: ${e.error}`))
  }

  // Total by client
  console.log('\nTotals by client:')
  const byClient = {}
  for (const inv of results.imported) {
    if (!byClient[inv.client]) byClient[inv.client] = { count: 0, total: 0, txMatched: 0, txUpdated: 0 }
    byClient[inv.client].count++
    byClient[inv.client].total += inv.total
    byClient[inv.client].txMatched += inv.txMatched
    byClient[inv.client].txUpdated += inv.txUpdated
  }
  for (const [client, stats] of Object.entries(byClient)) {
    console.log(`  ${client}: ${stats.count} invoices, $${stats.total.toFixed(2)} total, ${stats.txMatched} tx matched, ${stats.txUpdated} tx updated`)
  }

  return results
}

main().catch(console.error)
