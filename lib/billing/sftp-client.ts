/**
 * SFTP Client for fetching weekly shipping breakdown data from ShipBob
 *
 * ShipBob provides a weekly CSV with base cost, surcharges, and insurance
 * that we can't get from their API. This is a stopgap until API support.
 *
 * File naming: extras-MMDDYY.csv (e.g., extras-120125.csv for Dec 1, 2025)
 * Location: root directory on SFTP server (configurable via SFTP_REMOTE_PATH)
 *
 * CSV Columns:
 * - User ID: ShipBob merchant user ID
 * - Merchant Name: Brand name
 * - OrderID: Actually the shipment_id (unique identifier)
 * - Invoice Number: ShipBob invoice ID for cross-reference
 * - Fulfillment without Surcharge: Base shipping cost
 * - Surcharge Applied: Carrier surcharges
 * - Original Invoice: Total (base + surcharge, not including insurance)
 * - Insurance Amount: Insurance cost
 */

import Client from 'ssh2-sftp-client'
import { parse } from 'csv-parse/sync'
import type { SupabaseClient } from '@supabase/supabase-js'

// Parsed row from ShipBob extras CSV
export interface ShippingBreakdownRow {
  shipment_id: string
  user_id: string
  merchant_name: string
  invoice_id_sb: string
  base_cost: number
  surcharge: number
  insurance_cost: number
  total: number  // base_cost + surcharge (from "Original Invoice")
}

export interface FetchResult {
  success: boolean
  filename: string
  rows: ShippingBreakdownRow[]
  error?: string
}

/**
 * Parse currency string to number (strips $ and handles empty)
 */
function parseCurrency(value: string | undefined): number {
  if (!value) return 0
  // Remove $ and any commas, then parse
  const cleaned = value.replace(/[$,]/g, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Format date as MMDDYY for filename
 */
function formatDateForFilename(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}${dd}${yy}`
}

/**
 * Parse MMDDYY string to Date
 */
export function parseDateFromFilename(dateStr: string): Date {
  const mm = parseInt(dateStr.slice(0, 2), 10) - 1
  const dd = parseInt(dateStr.slice(2, 4), 10)
  const yy = parseInt(dateStr.slice(4, 6), 10)
  const year = yy < 50 ? 2000 + yy : 1900 + yy
  return new Date(year, mm, dd)
}

/**
 * Get SFTP connection config from environment
 */
function getConfig() {
  const host = process.env.SFTP_HOST
  const port = parseInt(process.env.SFTP_PORT || '22', 10)
  const username = process.env.SFTP_USERNAME
  const password = process.env.SFTP_PASSWORD
  const privateKey = process.env.SFTP_PRIVATE_KEY
  const remotePath = process.env.SFTP_REMOTE_PATH || '/'

  if (!host || !username) {
    throw new Error('SFTP_HOST and SFTP_USERNAME are required')
  }

  if (!password && !privateKey) {
    throw new Error('Either SFTP_PASSWORD or SFTP_PRIVATE_KEY is required')
  }

  return {
    host,
    port,
    username,
    password,
    privateKey: privateKey ? Buffer.from(privateKey, 'base64') : undefined,
    remotePath
  }
}

/**
 * Fetch weekly shipping breakdown CSV from SFTP
 *
 * @param invoiceDate - The Monday of the invoice week (e.g., 2025-12-01)
 * @returns Parsed shipping breakdown rows
 */
export async function fetchShippingBreakdown(invoiceDate: Date): Promise<FetchResult> {
  const sftp = new Client()
  const filename = `extras-${formatDateForFilename(invoiceDate)}.csv`

  try {
    const config = getConfig()

    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey
    })

    const remotePath = `${config.remotePath}/${filename}`

    // Check if file exists
    const exists = await sftp.exists(remotePath)
    if (!exists) {
      return {
        success: false,
        filename,
        rows: [],
        error: `File not found: ${remotePath}`
      }
    }

    // Download file contents
    const buffer = await sftp.get(remotePath) as Buffer
    const csvContent = buffer.toString('utf-8')

    // Parse CSV
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    })

    // Map to our interface
    const rows: ShippingBreakdownRow[] = (records as Record<string, string>[]).map((row) => ({
      shipment_id: String(row['OrderID'] || ''),
      user_id: String(row['User ID'] || ''),
      merchant_name: String(row['Merchant Name'] || ''),
      invoice_id_sb: String(row['Invoice Number'] || ''),
      base_cost: parseCurrency(row['Fulfillment without Surcharge']),
      surcharge: parseCurrency(row['Surcharge Applied']),
      insurance_cost: parseCurrency(row['Insurance Amount']),
      total: parseCurrency(row['Original Invoice'])
    }))

    return {
      success: true,
      filename,
      rows
    }

  } catch (error) {
    return {
      success: false,
      filename,
      rows: [],
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await sftp.end()
  }
}

/**
 * List available shipping breakdown files on SFTP
 */
export async function listAvailableFiles(): Promise<string[]> {
  const sftp = new Client()

  try {
    const config = getConfig()

    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey
    })

    const files = await sftp.list(config.remotePath)

    return files
      .filter(f => f.name.startsWith('extras-') && f.name.endsWith('.csv'))
      .map(f => f.name)
      .sort()
      .reverse()

  } finally {
    await sftp.end()
  }
}

/**
 * Build a lookup map from shipment_id to breakdown data
 */
export function buildBreakdownLookup(rows: ShippingBreakdownRow[]): Map<string, ShippingBreakdownRow> {
  const lookup = new Map<string, ShippingBreakdownRow>()
  for (const row of rows) {
    if (row.shipment_id) {
      lookup.set(row.shipment_id, row)
    }
  }
  return lookup
}

export interface UpdateResult {
  updated: number
  notFound: number
  errors: string[]
}

/**
 * Update transactions with shipping breakdown data from SFTP
 *
 * This updates the base_cost, surcharge, and insurance_cost columns on
 * transactions that match the shipment_id from the SFTP file.
 *
 * OPTIMIZED: Uses batch lookups and parallel updates instead of N+1 queries.
 * Old approach: 10,666 sequential queries for 5,333 rows (106+ seconds)
 * New approach: 1 batch lookup + ~53 parallel update batches (~5 seconds)
 */
export async function updateTransactionsWithBreakdown(
  supabase: SupabaseClient,
  rows: ShippingBreakdownRow[]
): Promise<UpdateResult> {
  const result: UpdateResult = { updated: 0, notFound: 0, errors: [] }

  if (rows.length === 0) {
    return result
  }

  // Step 1: Extract all unique shipment_ids from SFTP rows
  const shipmentIds = [...new Set(rows.map(r => r.shipment_id).filter(Boolean))]

  console.log(`  SFTP update: Looking up ${shipmentIds.length} unique shipment IDs...`)

  // Step 2: Batch fetch ALL matching transactions in chunks (Supabase .in() limit is ~1000)
  const LOOKUP_BATCH_SIZE = 500
  const txLookup = new Map<string, { id: string; invoice_id_sb: number | null }>()

  for (let i = 0; i < shipmentIds.length; i += LOOKUP_BATCH_SIZE) {
    const batchIds = shipmentIds.slice(i, i + LOOKUP_BATCH_SIZE)

    const { data: transactions, error: lookupError } = await supabase
      .from('transactions')
      .select('id, reference_id, invoice_id_sb, transaction_type')
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('reference_id', batchIds)

    if (lookupError) {
      result.errors.push(`Batch lookup error: ${lookupError.message}`)
      continue
    }

    // Build lookup map: shipment_id:invoice_id:type → transaction info
    // Use transaction_type to distinguish charge vs refund for same shipment in same invoice
    for (const tx of transactions || []) {
      const isRefund = tx.transaction_type === 'Refund'
      const typeKey = isRefund ? 'refund' : 'charge'

      if (tx.invoice_id_sb) {
        // Primary key: shipment:invoice:type (handles refund+charge in same invoice)
        const fullKey = `${tx.reference_id}:${tx.invoice_id_sb}:${typeKey}`
        txLookup.set(fullKey, { id: tx.id, invoice_id_sb: tx.invoice_id_sb })

        // Also store by shipment:invoice for backwards compatibility
        const invoiceKey = `${tx.reference_id}:${tx.invoice_id_sb}`
        if (!txLookup.has(invoiceKey)) {
          txLookup.set(invoiceKey, { id: tx.id, invoice_id_sb: tx.invoice_id_sb })
        }
      }

      // Fallback: just shipment_id
      if (!txLookup.has(tx.reference_id)) {
        txLookup.set(tx.reference_id, { id: tx.id, invoice_id_sb: tx.invoice_id_sb })
      }
    }
  }

  console.log(`  SFTP update: Found ${txLookup.size} matching transactions in DB`)

  // Step 3: Prepare updates and run in parallel batches
  const UPDATE_CONCURRENCY = 100  // Run 100 updates in parallel
  const updatePromises: Promise<{ success: boolean; shipmentId: string; error?: string }>[] = []

  for (const row of rows) {
    // Determine if this SFTP row is a refund (negative amounts) or charge (positive)
    const isRefundRow = row.base_cost < 0 || row.total < 0
    const typeKey = isRefundRow ? 'refund' : 'charge'

    // Try to find matching transaction:
    // 1. First by shipment:invoice:type (most specific, handles refund+charge in same invoice)
    // 2. Then by shipment:invoice (backwards compat)
    // 3. Finally by just shipment (fallback)
    const invoiceId = row.invoice_id_sb ? parseInt(row.invoice_id_sb, 10) : null
    const fullKey = invoiceId && !isNaN(invoiceId)
      ? `${row.shipment_id}:${invoiceId}:${typeKey}`
      : null
    const invoiceKey = invoiceId && !isNaN(invoiceId)
      ? `${row.shipment_id}:${invoiceId}`
      : null

    const tx = (fullKey && txLookup.get(fullKey))
      || (invoiceKey && txLookup.get(invoiceKey))
      || txLookup.get(row.shipment_id)

    if (!tx) {
      result.notFound++
      continue
    }

    // Queue update promise (wrap in Promise.resolve to ensure proper Promise type)
    const updatePromise = Promise.resolve(
      supabase
        .from('transactions')
        .update({
          base_cost: row.base_cost,
          surcharge: row.surcharge,
          insurance_cost: row.insurance_cost
        })
        .eq('id', tx.id)
    ).then(({ error }) => {
      if (error) {
        return { success: false, shipmentId: row.shipment_id, error: error.message }
      }
      return { success: true, shipmentId: row.shipment_id }
    })

    updatePromises.push(updatePromise)

    // Process in batches to avoid overwhelming the connection
    if (updatePromises.length >= UPDATE_CONCURRENCY) {
      const batchResults = await Promise.all(updatePromises.splice(0, UPDATE_CONCURRENCY))
      for (const r of batchResults) {
        if (r.success) {
          result.updated++
        } else {
          result.errors.push(`Error updating shipment ${r.shipmentId}: ${r.error}`)
        }
      }
    }
  }

  // Process remaining updates
  if (updatePromises.length > 0) {
    const batchResults = await Promise.all(updatePromises)
    for (const r of batchResults) {
      if (r.success) {
        result.updated++
      } else {
        result.errors.push(`Error updating shipment ${r.shipmentId}: ${r.error}`)
      }
    }
  }

  console.log(`  SFTP update complete: ${result.updated} updated, ${result.notFound} not found, ${result.errors.length} errors`)

  return result
}

// ============================================================================
// NEW DAILY FORMAT SUPPORT (Dec 2025)
// ============================================================================
//
// ShipBob now provides DAILY files with one row per fee type:
// File: JetPack_Shipment_Extras_YYYY-MM-DD.csv
// Columns: User ID, Merchant Name, Shipment ID, Fee_Type, Fee Amount
//
// Fee types:
// - "Base Rate" → base_cost
// - Everything else → surcharge (aggregated + stored in surcharge_details JSONB)
//
// IMPORTANT: SFTP files appear 1 day AFTER the transaction's charge_date
// e.g., transactions with charge_date 2025-12-27 appear in 2025-12-28 file

/** Single row from daily SFTP file (before aggregation) */
export interface DailyFeeRow {
  user_id: string
  merchant_name: string
  shipment_id: string
  fee_type: string
  fee_amount: number
}

/** Surcharge detail for JSONB storage */
export interface SurchargeDetail {
  type: string
  amount: number
}

/** Aggregated shipment cost data from daily file */
export interface DailyShipmentCost {
  shipment_id: string
  merchant_name: string
  base_cost: number
  surcharge: number  // aggregated sum of all surcharges
  surcharge_details: SurchargeDetail[]  // individual surcharges for JSONB
  insurance_cost: number
  total: number  // base + surcharges + insurance
}

export interface DailyFetchResult {
  success: boolean
  filename: string
  date: string  // YYYY-MM-DD
  rows: DailyShipmentCost[]
  rawRowCount: number  // rows before aggregation
  error?: string
}

/**
 * Format date as YYYY-MM-DD for daily filename
 */
function formatDateForDailyFilename(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Fetch daily shipping breakdown CSV from SFTP
 *
 * @param date - The date of the SFTP file (NOT the charge_date)
 *               For transactions charged on Dec 27, use Dec 28 file
 * @returns Aggregated shipping cost data grouped by shipment_id
 */
export async function fetchDailyShippingBreakdown(date: Date): Promise<DailyFetchResult> {
  const sftp = new Client()
  const dateStr = formatDateForDailyFilename(date)
  const filename = `JetPack_Shipment_Extras_${dateStr}.csv`

  try {
    const config = getConfig()

    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey
    })

    const remotePath = `${config.remotePath}/${filename}`

    // Check if file exists
    const exists = await sftp.exists(remotePath)
    if (!exists) {
      return {
        success: false,
        filename,
        date: dateStr,
        rows: [],
        rawRowCount: 0,
        error: `File not found: ${remotePath}`
      }
    }

    // Download file contents
    const buffer = await sftp.get(remotePath) as Buffer
    const csvContent = buffer.toString('utf-8')

    // Parse CSV
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    })

    // Parse raw rows
    const rawRows: DailyFeeRow[] = (records as Record<string, string>[]).map((row) => ({
      user_id: String(row['User ID'] || ''),
      merchant_name: String(row['Merchant Name'] || ''),
      shipment_id: String(row['Shipment ID'] || ''),
      fee_type: String(row['Fee_Type'] || row['Fee Type'] || ''),
      fee_amount: parseCurrency(row['Fee Amount'] || row['Fee_Amount'] || '0')
    }))

    // Aggregate by shipment_id
    const byShipment = new Map<string, DailyShipmentCost>()

    for (const row of rawRows) {
      if (!row.shipment_id) continue

      if (!byShipment.has(row.shipment_id)) {
        byShipment.set(row.shipment_id, {
          shipment_id: row.shipment_id,
          merchant_name: row.merchant_name,
          base_cost: 0,
          surcharge: 0,
          surcharge_details: [],
          insurance_cost: 0,
          total: 0
        })
      }

      const agg = byShipment.get(row.shipment_id)!
      const feeTypeLower = row.fee_type.toLowerCase()

      if (feeTypeLower === 'base rate') {
        agg.base_cost += row.fee_amount
      } else if (feeTypeLower.includes('insurance')) {
        agg.insurance_cost += row.fee_amount
      } else {
        // It's a surcharge - track both aggregate and details
        agg.surcharge += row.fee_amount
        agg.surcharge_details.push({
          type: row.fee_type,
          amount: row.fee_amount
        })
      }

      agg.total += row.fee_amount
    }

    return {
      success: true,
      filename,
      date: dateStr,
      rows: Array.from(byShipment.values()),
      rawRowCount: rawRows.length
    }

  } catch (error) {
    return {
      success: false,
      filename,
      date: dateStr,
      rows: [],
      rawRowCount: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await sftp.end()
  }
}

export interface DailyUpdateResult {
  updated: number
  notFound: number
  errors: string[]
}

/**
 * Update transactions with daily shipping breakdown data
 *
 * Updates base_cost, surcharge, insurance_cost, AND the new surcharge_details JSONB column.
 *
 * IMPORTANT: Handles RESHIPMENTS correctly. Same shipment_id can have multiple Shipping
 * transactions on different dates. The SFTP file date = charge_date + 1 day, so we use
 * the charge_date to match the correct transaction.
 *
 * @param supabase - Supabase client
 * @param rows - Aggregated shipment cost data from daily SFTP file
 * @param fileDate - The SFTP file date (used to calculate expected charge_date)
 */
export async function updateTransactionsWithDailyBreakdown(
  supabase: SupabaseClient,
  rows: DailyShipmentCost[],
  fileDate?: Date
): Promise<DailyUpdateResult> {
  const result: DailyUpdateResult = { updated: 0, notFound: 0, errors: [] }

  if (rows.length === 0) {
    return result
  }

  // Calculate expected charge_date from file date (charge_date = file_date - 1 day)
  // This is used to match the correct transaction for reshipments
  let expectedChargeDate: string | null = null
  if (fileDate) {
    const chargeDateObj = new Date(fileDate)
    chargeDateObj.setDate(chargeDateObj.getDate() - 1)
    expectedChargeDate = `${chargeDateObj.getFullYear()}-${String(chargeDateObj.getMonth() + 1).padStart(2, '0')}-${String(chargeDateObj.getDate()).padStart(2, '0')}`
    console.log(`  Daily SFTP update: Expected charge_date for this file: ${expectedChargeDate}`)
  }

  // Step 1: Extract all unique shipment_ids
  const shipmentIds = [...new Set(rows.map(r => r.shipment_id).filter(Boolean))]

  console.log(`  Daily SFTP update: Looking up ${shipmentIds.length} unique shipment IDs...`)

  // Step 2: Batch fetch ALL matching transactions (including multiple per shipment for reshipments)
  const LOOKUP_BATCH_SIZE = 500
  // Map: shipment_id:charge_date:type → transaction id (for precise matching including refunds)
  // Also: shipment_id → array of {id, charge_date, transaction_type} for fallback
  const txByShipmentDateType = new Map<string, string>()
  const txByShipment = new Map<string, Array<{ id: string; charge_date: string | null; transaction_type: string | null }>>()

  for (let i = 0; i < shipmentIds.length; i += LOOKUP_BATCH_SIZE) {
    const batchIds = shipmentIds.slice(i, i + LOOKUP_BATCH_SIZE)

    const { data: transactions, error: lookupError } = await supabase
      .from('transactions')
      .select('id, reference_id, charge_date, transaction_type')
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('reference_id', batchIds)

    if (lookupError) {
      result.errors.push(`Batch lookup error: ${lookupError.message}`)
      continue
    }

    for (const tx of transactions || []) {
      // Build lookup by shipment:charge_date:type for precise matching (handles charge+refund on same day)
      const isRefund = tx.transaction_type === 'Refund'
      const typeKey = isRefund ? 'refund' : 'charge'
      if (tx.charge_date) {
        const key = `${tx.reference_id}:${tx.charge_date}:${typeKey}`
        txByShipmentDateType.set(key, tx.id)
      }

      // Also build array per shipment for fallback
      if (!txByShipment.has(tx.reference_id)) {
        txByShipment.set(tx.reference_id, [])
      }
      txByShipment.get(tx.reference_id)!.push({
        id: tx.id,
        charge_date: tx.charge_date,
        transaction_type: tx.transaction_type
      })
    }
  }

  const totalTxCount = Array.from(txByShipment.values()).reduce((sum, arr) => sum + arr.length, 0)
  console.log(`  Daily SFTP update: Found ${totalTxCount} matching transactions for ${txByShipment.size} shipments in DB`)

  // Step 3: Prepare and run updates in parallel batches
  const UPDATE_CONCURRENCY = 100
  const updatePromises: Promise<{ success: boolean; shipmentId: string; error?: string }>[] = []

  for (const row of rows) {
    // Find matching transaction ID
    let txId: string | undefined

    // Determine if this SFTP row is a refund (negative amounts) or charge (positive)
    const isRefundRow = row.base_cost < 0 || row.total < 0
    const rowTypeKey = isRefundRow ? 'refund' : 'charge'

    // Strategy 1: Match by shipment_id + expected charge_date + type (most precise, handles charge+refund on same day)
    if (expectedChargeDate) {
      const key = `${row.shipment_id}:${expectedChargeDate}:${rowTypeKey}`
      txId = txByShipmentDateType.get(key)
    }

    // Strategy 2: Fallback to matching transaction by type for this shipment
    if (!txId) {
      const txArray = txByShipment.get(row.shipment_id)
      if (txArray && txArray.length > 0) {
        // Try to find a transaction with matching type (charge vs refund)
        const matchingType = txArray.find(t =>
          (isRefundRow && t.transaction_type === 'Refund') ||
          (!isRefundRow && t.transaction_type !== 'Refund')
        )
        if (matchingType) {
          txId = matchingType.id
        } else {
          // Last resort: take first available
          txId = txArray[0].id
        }
      }
    }

    if (!txId) {
      result.notFound++
      continue
    }

    const updatePromise = Promise.resolve(
      supabase
        .from('transactions')
        .update({
          base_cost: row.base_cost,
          surcharge: row.surcharge,
          surcharge_details: row.surcharge_details.length > 0 ? row.surcharge_details : null,
          insurance_cost: row.insurance_cost
        })
        .eq('id', txId)
    ).then(({ error }) => {
      if (error) {
        return { success: false, shipmentId: row.shipment_id, error: error.message }
      }
      return { success: true, shipmentId: row.shipment_id }
    })

    updatePromises.push(updatePromise)

    // Process in batches
    if (updatePromises.length >= UPDATE_CONCURRENCY) {
      const batchResults = await Promise.all(updatePromises.splice(0, UPDATE_CONCURRENCY))
      for (const r of batchResults) {
        if (r.success) {
          result.updated++
        } else {
          result.errors.push(`Error updating shipment ${r.shipmentId}: ${r.error}`)
        }
      }
    }
  }

  // Process remaining updates
  if (updatePromises.length > 0) {
    const batchResults = await Promise.all(updatePromises)
    for (const r of batchResults) {
      if (r.success) {
        result.updated++
      } else {
        result.errors.push(`Error updating shipment ${r.shipmentId}: ${r.error}`)
      }
    }
  }

  console.log(`  Daily SFTP update complete: ${result.updated} updated, ${result.notFound} not found, ${result.errors.length} errors`)

  return result
}
