#!/usr/bin/env node
/**
 * Invoice Verification Script
 *
 * Compares ShipBob source invoices against our database transactions
 * to verify all costs are captured correctly before approving invoices.
 *
 * Usage:
 *   node scripts/verify-invoices.js
 *
 * Place ShipBob invoice XLS files in: reference/sb-invoice-xls/
 * Format: Invoice_XXXXXXX.xlsx (e.g., Invoice_8754805.xlsx)
 */

require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SB_INVOICE_DIR = 'reference/sb-invoice-xls'

/**
 * Parse currency string to number
 * Handles formats like: $10.27, ($10.27), -$ 80, -$11.46, etc.
 */
function parseCurrency(value) {
  if (!value) return 0
  const str = String(value)

  // Handle accounting format: ($10.27) is negative
  if (str.includes('(') && str.includes(')')) {
    const cleaned = str.replace(/[\$,()]/g, '').trim()
    return -parseFloat(cleaned) || 0
  }

  // Remove $ and commas, then collapse spaces around minus sign
  // This handles "-$ 80" -> "-80"
  let cleaned = str.replace(/[\$,]/g, '').trim()
  cleaned = cleaned.replace(/^-\s+/, '-') // Handle "- 80" -> "-80"

  return parseFloat(cleaned) || 0
}

/**
 * Parse a ShipBob invoice XLS file
 * Different invoice types have different column structures!
 */
function parseShipBobInvoice(filePath) {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets['Invoice']
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  // Extract invoice ID from first row
  const firstRow = data[0] ? String(data[0][0] || '') : ''
  const invoiceIdMatch = firstRow.match(/Invoice (\d+)/)
  const invoiceId = invoiceIdMatch ? invoiceIdMatch[1] : null

  // Determine invoice type
  let invoiceType = 'unknown'
  if (firstRow.includes('Fulfillment Fees')) invoiceType = 'shipping'
  else if (firstRow.includes('Inbound Fees')) invoiceType = 'receiving'
  else if (firstRow.includes('Additional Fees')) invoiceType = 'additional'
  else if (firstRow.includes('Returns Fees')) invoiceType = 'returns'
  else if (firstRow.includes('Credits')) invoiceType = 'credits'
  else if (firstRow.includes('Storage')) invoiceType = 'storage'

  // Parse rows (header is at row 10, data starts at row 11)
  const transactions = []
  let totalAmount = 0
  let totalGST = 0
  const feeTypeCounts = {}

  for (let i = 11; i < data.length; i++) {
    const row = data[i]
    if (!row || !row[0]) continue

    // Skip footer rows
    if (String(row[0]).includes('Total:')) continue
    if (String(row[0]).includes('*')) continue

    let feeType, amount, gst

    // Credits invoice has different column structure:
    // Date, FC, Fee Type, Reference Type, Reference ID, Credit Reason, Ticket Reference, GST Rate, Amount, GST
    if (invoiceType === 'credits') {
      feeType = row[2] // "Credit"
      if (!feeType || typeof feeType !== 'string') continue
      amount = parseCurrency(row[8])
      gst = parseCurrency(row[9])
    } else {
      // Standard invoice structure:
      // Date, FC, Reference ID, Fee Type, Notes, Store Order ID, GST Rate, Amount, GST, Total
      feeType = row[3]
      if (!feeType || typeof feeType !== 'string') continue
      amount = parseCurrency(row[7])
      gst = parseCurrency(row[8])
    }

    transactions.push({
      date: row[0],
      fc: row[1],
      feeType,
      amount,
      gst,
      totalInclGst: amount + gst
    })

    // Count by fee type
    feeTypeCounts[feeType] = (feeTypeCounts[feeType] || 0) + 1

    totalAmount += amount
    totalGST += gst
  }

  return {
    invoiceId,
    invoiceType,
    filePath,
    transactions,
    feeTypeCounts,
    summary: {
      count: transactions.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalGST: Math.round(totalGST * 100) / 100,
      totalInclGST: Math.round((totalAmount + totalGST) * 100) / 100
    }
  }
}

/**
 * Get aggregate stats from database using cursor-based pagination
 * (Supabase returns max 1000 rows per query)
 */
async function getDbStats(invoiceIds) {
  const results = {}

  for (const invoiceId of invoiceIds) {
    const id = parseInt(invoiceId)

    // Fetch ALL transactions using cursor-based pagination
    const pageSize = 1000
    let lastId = null
    const allTxData = []

    while (true) {
      let query = supabase
        .from('transactions')
        .select('transaction_id, fee_type, cost, taxes, client_id')
        .eq('invoice_id_sb', id)
        .order('transaction_id', { ascending: true })
        .limit(pageSize)

      if (lastId) {
        query = query.gt('transaction_id', lastId)
      }

      const { data: txData, error } = await query

      if (error) {
        console.error(`Error fetching invoice ${id}:`, error)
        break
      }

      if (!txData || txData.length === 0) break

      allTxData.push(...txData)
      lastId = txData[txData.length - 1].transaction_id

      if (txData.length < pageSize) break // Last page
    }

    if (allTxData.length === 0) continue

    // Aggregate
    const byFeeType = {}
    const byClient = {}
    let totalCost = 0
    let totalGst = 0

    for (const tx of allTxData) {
      const ft = tx.fee_type || 'Unknown'
      if (!byFeeType[ft]) {
        byFeeType[ft] = { count: 0, total: 0 }
      }
      byFeeType[ft].count++
      byFeeType[ft].total += tx.cost || 0
      totalCost += tx.cost || 0

      // GST from taxes JSONB
      if (tx.taxes && Array.isArray(tx.taxes)) {
        for (const t of tx.taxes) {
          totalGst += t.tax_amount || 0
        }
      }

      // By client
      const clientId = tx.client_id || '__unattributed__'
      if (!byClient[clientId]) {
        byClient[clientId] = { count: 0, total: 0 }
      }
      byClient[clientId].count++
      byClient[clientId].total += tx.cost || 0
    }

    results[invoiceId] = {
      totalCount: allTxData.length,
      totalCost: Math.round(totalCost * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      byFeeType,
      byClient
    }
  }

  return results
}

/**
 * Get client names for display
 */
async function getClientNames() {
  const { data } = await supabase
    .from('clients')
    .select('id, company_name')

  const map = {}
  for (const c of data || []) {
    map[c.id] = c.company_name
  }
  return map
}

async function main() {
  console.log('='.repeat(80))
  console.log('INVOICE VERIFICATION REPORT')
  console.log('='.repeat(80))
  console.log('')

  // Check if directory exists
  if (!fs.existsSync(SB_INVOICE_DIR)) {
    console.log(`No ShipBob invoice directory found at: ${SB_INVOICE_DIR}`)
    console.log('Please create the directory and add ShipBob invoice XLS files.')
    return
  }

  // Find all invoice files
  const files = fs.readdirSync(SB_INVOICE_DIR)
    .filter(f => f.endsWith('.xlsx') && f.startsWith('Invoice_'))

  if (files.length === 0) {
    console.log('No invoice files found in:', SB_INVOICE_DIR)
    return
  }

  console.log(`Found ${files.length} ShipBob invoice files`)
  console.log('')

  // Parse all ShipBob invoices
  const sbInvoices = []
  for (const file of files) {
    const filePath = path.join(SB_INVOICE_DIR, file)
    const invoice = parseShipBobInvoice(filePath)
    sbInvoices.push(invoice)
  }

  // Get all invoice IDs
  const invoiceIds = sbInvoices.map(i => i.invoiceId).filter(Boolean)

  // Fetch DB stats
  console.log('Fetching transaction data from database...')
  const dbStats = await getDbStats(invoiceIds)
  const clientNames = await getClientNames()
  console.log('')

  // Compare each invoice
  let hasIssues = false
  let sbGrandTotal = 0
  let dbGrandTotal = 0

  for (const sbInvoice of sbInvoices) {
    const invoiceId = sbInvoice.invoiceId
    const dbData = dbStats[invoiceId] || { totalCount: 0, totalCost: 0, totalGst: 0, byFeeType: {}, byClient: {} }

    console.log('-'.repeat(80))
    console.log(`Invoice ${invoiceId} (${sbInvoice.invoiceType.toUpperCase()})`)
    console.log('-'.repeat(80))

    // Fee type comparison table
    console.log('')
    console.log('FEE TYPE COMPARISON:')
    console.log('  ' + 'Fee Type'.padEnd(40) + 'ShipBob'.padStart(12) + 'Database'.padStart(12) + 'Diff'.padStart(10))
    console.log('  ' + '-'.repeat(74))

    const allFeeTypes = new Set([
      ...Object.keys(sbInvoice.feeTypeCounts),
      ...Object.keys(dbData.byFeeType)
    ])

    for (const ft of allFeeTypes) {
      const sbCount = sbInvoice.feeTypeCounts[ft] || 0
      const dbFt = dbData.byFeeType[ft] || { count: 0, total: 0 }
      const diff = dbFt.count - sbCount
      const diffStr = diff === 0 ? '✓' : (diff > 0 ? `+${diff}` : `${diff}`)
      console.log('  ' + ft.padEnd(40) + String(sbCount).padStart(12) + String(dbFt.count).padStart(12) + diffStr.padStart(10))
    }

    // Totals - DB cost INCLUDES tax, so compare to ShipBob's totalInclGST
    console.log('')
    console.log('TOTALS:')
    console.log(`  ShipBob: ${sbInvoice.summary.count} txns, $${sbInvoice.summary.totalAmount.toFixed(2)} + $${sbInvoice.summary.totalGST.toFixed(2)} GST = $${sbInvoice.summary.totalInclGST.toFixed(2)}`)
    console.log(`  Database: ${dbData.totalCount} txns, $${dbData.totalCost.toFixed(2)} (incl. $${dbData.totalGst.toFixed(2)} tax)`)

    const countDiff = dbData.totalCount - sbInvoice.summary.count
    // Compare DB cost (which includes tax) to ShipBob total incl GST
    const amountDiff = dbData.totalCost - sbInvoice.summary.totalInclGST

    if (countDiff !== 0 || Math.abs(amountDiff) > 0.02) {
      hasIssues = true
      console.log('')
      console.log('  ⚠️  DISCREPANCY:')
      if (countDiff !== 0) {
        console.log(`     Count: ${countDiff > 0 ? '+' : ''}${countDiff} transactions`)
      }
      if (Math.abs(amountDiff) > 0.02) {
        console.log(`     Amount: ${amountDiff > 0 ? '+' : ''}$${amountDiff.toFixed(2)} (DB incl tax vs SB incl GST)`)
      }
    } else {
      console.log('')
      console.log('  ✅ Counts and amounts match!')
    }

    // Client breakdown
    if (Object.keys(dbData.byClient).length > 0) {
      console.log('')
      console.log('BY CLIENT (Database):')
      const clients = Object.entries(dbData.byClient)
        .map(([id, stats]) => ({
          name: id === '__unattributed__' ? 'UNATTRIBUTED' : (clientNames[id] || id.slice(0, 8)),
          count: stats.count,
          total: stats.total
        }))
        .sort((a, b) => b.total - a.total)

      for (const c of clients) {
        console.log(`  ${c.name}: ${c.count} txns, $${c.total.toFixed(2)}`)
      }

      // Check for unattributed
      if (dbData.byClient['__unattributed__']) {
        hasIssues = true
        console.log('')
        console.log(`  ⚠️  ${dbData.byClient['__unattributed__'].count} unattributed transactions!`)
      }
    }

    sbGrandTotal += sbInvoice.summary.totalInclGST  // Use total incl GST for proper comparison
    dbGrandTotal += dbData.totalCost

    console.log('')
  }

  // Final summary
  console.log('='.repeat(80))
  console.log('VERIFICATION SUMMARY')
  console.log('='.repeat(80))
  console.log('')
  console.log(`ShipBob Grand Total (incl GST): $${sbGrandTotal.toFixed(2)}`)
  console.log(`Database Grand Total (incl tax): $${dbGrandTotal.toFixed(2)}`)
  console.log(`Difference: $${(dbGrandTotal - sbGrandTotal).toFixed(2)}`)
  console.log('')

  if (hasIssues) {
    console.log('⚠️  Some discrepancies found - review above before approving invoices')
  } else {
    console.log('✅ All invoices verified successfully!')
  }
}

main().catch(console.error)
