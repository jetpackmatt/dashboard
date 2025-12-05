#!/usr/bin/env npx tsx
/**
 * List all merchants from historic Excel data
 *
 * Goal: Find which merchants have shipped recently and get their User IDs
 *
 * Run with: npx tsx scripts/list-all-merchants.ts
 */

import * as path from 'path'
import * as XLSX from 'xlsx'

const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(msg: string, color = c.reset) {
  console.log(`${color}${msg}${c.reset}`)
}

function header(title: string) {
  console.log('\n' + '='.repeat(70))
  log(title, c.bright + c.cyan)
  console.log('='.repeat(70))
}

async function list() {
  header('Load Historic Shipments Excel')

  const shipmentsPath = path.resolve(process.cwd(), 'reference/data/historic/shipments.xlsx')
  const workbook = XLSX.readFile(shipmentsPath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

  log(`Total rows: ${data.length}`, c.dim)

  header('All Merchants by Transaction Count')

  // Group by merchant
  const merchantCounts = new Map<string, { userId: string; count: number; latestDate: number }>()

  data.forEach(row => {
    const merchantName = String(row['Merchant Name'] || 'Unknown')
    const userId = String(row['User ID'] || 'Unknown')
    const dateRaw = row['Transaction Date']

    // Excel stores dates as serial numbers
    const dateNum = typeof dateRaw === 'number' ? dateRaw : 0

    const existing = merchantCounts.get(merchantName)
    if (!existing) {
      merchantCounts.set(merchantName, { userId, count: 1, latestDate: dateNum })
    } else {
      existing.count++
      if (dateNum > existing.latestDate) {
        existing.latestDate = dateNum
      }
    }
  })

  // Convert Excel serial date to readable date
  function excelDateToJS(serial: number): string {
    if (serial === 0) return 'Unknown'
    // Excel epoch is Dec 30, 1899
    const epoch = new Date(1899, 11, 30)
    const days = Math.floor(serial)
    const date = new Date(epoch.getTime() + days * 24 * 60 * 60 * 1000)
    return date.toISOString().split('T')[0]
  }

  // Sort by count descending
  const sorted = [...merchantCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)

  log(`\n${c.bright}${'Merchant Name'.padEnd(30)} ${'User ID'.padEnd(12)} ${'Transactions'.padEnd(12)} Latest Date${c.reset}`)
  log('-'.repeat(70))

  sorted.forEach(([name, data]) => {
    const latestStr = excelDateToJS(data.latestDate)
    log(`${name.substring(0, 28).padEnd(30)} ${data.userId.padEnd(12)} ${String(data.count).padEnd(12)} ${latestStr}`)
  })

  header('User IDs for Testing')
  log(`\nThese are all your child merchant User IDs:`, c.dim)
  sorted.forEach(([name, data]) => {
    log(`  ${data.userId} = ${name}`, c.green)
  })

  // Check which merchants have the most recent dates
  header('Most Recently Active Merchants')

  const byDate = [...merchantCounts.entries()]
    .sort((a, b) => b[1].latestDate - a[1].latestDate)
    .slice(0, 5)

  byDate.forEach(([name, data]) => {
    log(`${name}: ${excelDateToJS(data.latestDate)} (User ID: ${data.userId})`, c.bright)
  })
}

list().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
