/**
 * SFTP Client for fetching weekly shipping breakdown data from ShipBob
 *
 * ShipBob provides a weekly CSV with base cost, surcharges, and insurance
 * that we can't get from their API. This is a stopgap until API support.
 *
 * File naming: extras-MMDDYY.csv (e.g., extras-120125.csv for Dec 1, 2025)
 * Location: /shipbob-data on SFTP server
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
  const remotePath = process.env.SFTP_REMOTE_PATH || '/shipbob-data'

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
 */
export async function updateTransactionsWithBreakdown(
  supabase: SupabaseClient,
  rows: ShippingBreakdownRow[]
): Promise<UpdateResult> {
  const result: UpdateResult = { updated: 0, notFound: 0, errors: [] }

  if (rows.length === 0) {
    return result
  }

  // Process in batches
  const batchSize = 100

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)

    for (const row of batch) {
      // Find matching transaction by shipment_id (reference_id for Shipment transactions)
      const { data: tx, error: findError } = await supabase
        .from('transactions')
        .select('id')
        .eq('reference_type', 'Shipment')
        .eq('reference_id', row.shipment_id)
        .eq('transaction_fee', 'Shipping')
        .maybeSingle()

      if (findError) {
        result.errors.push(`Error finding shipment ${row.shipment_id}: ${findError.message}`)
        continue
      }

      if (!tx) {
        result.notFound++
        continue
      }

      // Update the transaction with breakdown data
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          base_cost: row.base_cost,
          surcharge: row.surcharge,
          insurance_cost: row.insurance_cost
        })
        .eq('id', tx.id)

      if (updateError) {
        result.errors.push(`Error updating transaction ${tx.id}: ${updateError.message}`)
        continue
      }

      result.updated++
    }
  }

  return result
}
