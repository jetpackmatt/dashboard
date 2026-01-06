#!/usr/bin/env node

/**
 * Storage Mapping Report
 *
 * Shows which storage invoice IDs are available and which JP invoices they
 * would map to with prefix-based matching.
 *
 * This helps identify where storage needs manual mapping.
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

// JP date suffix to prefix mapping (for reference)
const JP_DATE_TO_SB_PREFIX = {
  '032425': ['750', '747', '743'],
  '033125': ['752'],
  '040725': ['756'],
  '041425': ['759'],
  '042125': ['762'],
  '042825': ['765'],
  '050525': ['769'],
  '051225': ['772'],
  '051925': ['775'],
  '052625': ['778'],
  '060225': ['781'],
  '060925': ['784'],
  '061625': ['788'],
  '062325': ['791'],
  '063025': ['793'],
  '070725': ['797'],
  '071425': ['799'],
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

// Invert the mapping: prefix -> date suffix
const PREFIX_TO_JP_DATE = {}
for (const [date, prefixes] of Object.entries(JP_DATE_TO_SB_PREFIX)) {
  for (const prefix of prefixes) {
    PREFIX_TO_JP_DATE[prefix] = date
  }
}

// Aggregate storage by merchant and invoice
const storageByMerchant = {}

for (const row of rows) {
  const merchant = row['Merchant Name']
  if (!merchant || merchant === 'Eli Health') continue

  const invoiceId = String(row['Invoice Number'] || '')
  if (!invoiceId || invoiceId === '0') continue

  const invoiceDate = excelDateToJS(row['Invoice Date'])
  const amount = parseFloat(row['Invoice']) || 0

  if (!storageByMerchant[merchant]) {
    storageByMerchant[merchant] = []
  }

  const existing = storageByMerchant[merchant].find(s => s.invoiceId === invoiceId)
  if (existing) {
    existing.amount += amount
  } else {
    storageByMerchant[merchant].push({
      invoiceId,
      prefix: invoiceId.substring(0, 3),
      billedDate: invoiceDate,
      amount
    })
  }
}

// For each merchant, show storage invoice -> JP invoice mapping
for (const [merchant, storageInvoices] of Object.entries(storageByMerchant)) {
  const prefix = merchant === 'Methyl-Life®' ? 'JPML' : 'JPHS'

  console.log(`\n${'='.repeat(70)}`)
  console.log(`${merchant} - Storage Invoice to JP Invoice Mapping`)
  console.log('='.repeat(70))
  console.log('')
  console.log('SB Invoice | Prefix | Billed     | Amount     | → JP Invoice (by prefix)')
  console.log('-----------|--------|------------|------------|-------------------------')

  const sorted = storageInvoices.sort((a, b) => a.billedDate?.localeCompare(b.billedDate || '') || 0)

  for (const storage of sorted) {
    const jpDate = PREFIX_TO_JP_DATE[storage.prefix]
    const jpInvoice = jpDate ? `${prefix}-xxxx-${jpDate}` : 'NO MAPPING'

    console.log(
      `${storage.invoiceId.padEnd(10)} | ${storage.prefix.padEnd(6)} | ${(storage.billedDate || 'N/A').padEnd(10)} | $${storage.amount.toFixed(2).padStart(9)} | ${jpInvoice}`
    )
  }
}

console.log('\n\n' + '='.repeat(70))
console.log('METHYL-LIFE STORAGE: What Needs Verification')
console.log('='.repeat(70))
console.log(`
Based on prefix matching:
- JPML-xxxx-100625 (Oct 6 invoice) would get storage from SB 8373859 = $1,766.92
- JPML-xxxx-101325 (Oct 13 invoice) would get storage from SB 8401501 = $1,328.87

But you said:
- JPML-0013-100625 PDF shows $1,328.87 in storage (NOT $1,766.92)
- JPML-0014-101325 should have NO storage

This means the prefix-based storage mapping is WRONG for Methyl-Life.

QUESTIONS TO ANSWER BY CHECKING PDFs:
1. Which JP invoice has the $1,766.92 storage charge? (SB invoice 8373859)
2. Does JPML-0014 really have zero storage?
3. Check other ML invoices - does storage match prefix or is there a pattern?
`)
