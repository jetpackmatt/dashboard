#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')

const workbook = XLSX.readFile('reference/storage-backfills/storage-122225.xlsx')
const sheet = workbook.Sheets[workbook.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet)
const dataRows = rows.filter(r => r['Inventory ID'] && !isNaN(r['ChargeStartdate']))

// Check the Bin group that showed 0.13 vs 0.1290
const binTx = dataRows.filter(r =>
  String(r['Inventory ID']) === '20578077' &&
  r['Location Type'] === 'Bin'
)

console.log('20578077-Bin transactions from xlsx:')
for (const tx of binTx.slice(0, 5)) {
  const amt = parseFloat(tx['Invoice'])
  console.log('  xlsx:', amt, '→ rounded:', Math.round(amt * 100) / 100)
}

// Sum and round
const sum = binTx.reduce((s, r) => s + (parseFloat(r['Invoice']) || 0), 0)
console.log('\nSum:', sum)
console.log('Rounded to 2 decimals:', Math.round(sum * 100) / 100)

// Also check a larger group
const palletTx = dataRows.filter(r =>
  String(r['Inventory ID']) === '20101188' &&
  r['Location Type'] === 'Pallet'
)
console.log('\n20101188-Pallet from xlsx:')
const palletSum = palletTx.reduce((s, r) => s + (parseFloat(r['Invoice']) || 0), 0)
console.log('  Count:', palletTx.length)
console.log('  Sum (4 decimals):', palletSum.toFixed(4))
console.log('  Sum (2 decimals):', (Math.round(palletSum * 100) / 100).toFixed(2))

// Calculate the expected totals when rounded to 2 decimals
const allRounded = dataRows.map(r => Math.round((parseFloat(r['Invoice']) || 0) * 100) / 100)
const totalRounded = allRounded.reduce((s, a) => s + a, 0)
console.log('\n=== Total if each tx is rounded to 2 decimals ===')
console.log('Total:', totalRounded.toFixed(2))
console.log('DB total: 1131.15')
