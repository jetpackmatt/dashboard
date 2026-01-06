#!/usr/bin/env node

/**
 * Analyze storage invoice patterns to understand the billing cycle
 */

const XLSX = require('xlsx')
const path = require('path')

function excelDateToJS(serial) {
  if (!serial) return null
  const days = Math.floor(serial)
  const date = new Date((days - 25569) * 86400000)
  return date.toISOString().split('T')[0]
}

const wb = XLSX.readFile(path.join(__dirname, '../reference/cost-history', 'costs-storage.xlsx'))
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet)

// Group storage by merchant and invoice ID, with dates
const byMerchant = {}

for (const row of rows) {
  const merchant = row['Merchant Name']
  if (!merchant) continue

  const invoiceId = String(row['Invoice Number'] || '')
  if (!invoiceId || invoiceId === '0') continue

  const invoiceDate = excelDateToJS(row['Invoice Date'])
  const chargeStart = excelDateToJS(row['ChargeStartdate'])
  const amount = parseFloat(row['Invoice']) || 0

  if (!byMerchant[merchant]) {
    byMerchant[merchant] = {}
  }

  if (!byMerchant[merchant][invoiceId]) {
    byMerchant[merchant][invoiceId] = {
      amount: 0,
      invoiceDate: invoiceDate,
      chargeStartMin: chargeStart,
      chargeStartMax: chargeStart
    }
  }

  const inv = byMerchant[merchant][invoiceId]
  inv.amount += amount
  if (chargeStart && (!inv.chargeStartMin || chargeStart < inv.chargeStartMin)) {
    inv.chargeStartMin = chargeStart
  }
  if (chargeStart && (!inv.chargeStartMax || chargeStart > inv.chargeStartMax)) {
    inv.chargeStartMax = chargeStart
  }
}

// Print results
for (const [merchant, invoices] of Object.entries(byMerchant)) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${merchant}`)
  console.log('='.repeat(60))

  const sorted = Object.entries(invoices)
    .filter(([, data]) => data.amount > 0)
    .sort((a, b) => {
      // Sort by invoice date
      if (a[1].invoiceDate && b[1].invoiceDate) {
        return a[1].invoiceDate.localeCompare(b[1].invoiceDate)
      }
      return parseInt(a[0]) - parseInt(b[0])
    })

  console.log('Invoice ID   | Prefix | Billed Date | Charge Period         | Amount')
  console.log('-------------|--------|-------------|----------------------|--------')

  for (const [id, data] of sorted) {
    const prefix = id.substring(0, 3)
    const period = data.chargeStartMin === data.chargeStartMax
      ? data.chargeStartMin || 'N/A'
      : `${data.chargeStartMin} - ${data.chargeStartMax}`
    console.log(
      `${id.padEnd(12)} | ${prefix.padEnd(6)} | ${(data.invoiceDate || 'N/A').padEnd(11)} | ${period.padEnd(20)} | $${data.amount.toFixed(2)}`
    )
  }
}

// Now show the JP invoice date to prefix mapping for reference
console.log('\n\n' + '='.repeat(60))
console.log('JP Invoice Date Suffix to SB Prefix Mapping (for reference)')
console.log('='.repeat(60))

const JP_DATE_TO_SB_PREFIX = {
  '072125': ['803'],
  '072825': ['806'],
  '080425': ['809'],
  '081125': ['812'],
  '081825': ['815'],
  '082525': ['818'],
  '090125': ['822'],
  '090825': ['824'],
  '091525': ['827'],
  '092225': ['830'],
  '092925': ['833'],
  '100625': ['837'],
  '101325': ['840'],
  '102025': ['843'],
  '102725': ['846'],
  '110325': ['849'],
  '111025': ['852'],
  '111725': ['856'],
  '112425': ['859'],
  '120125': ['863'],
}

console.log('JP Date   | JP Invoice Week | SB Prefix')
console.log('----------|-----------------|----------')

for (const [date, prefixes] of Object.entries(JP_DATE_TO_SB_PREFIX).sort()) {
  const month = date.substring(0, 2)
  const day = date.substring(2, 4)
  const year = '20' + date.substring(4)
  console.log(`${date.padEnd(9)} | ${month}/${day}/${year}       | ${prefixes.join(', ')}`)
}
