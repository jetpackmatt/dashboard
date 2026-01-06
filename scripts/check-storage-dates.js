#!/usr/bin/env node
const XLSX = require('xlsx')
const path = require('path')

const wb = XLSX.readFile(path.join(__dirname, '../reference/cost-history/costs-storage.xlsx'))
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet)

console.log('Methyl-Life Storage by Invoice ID:\n')

const byInvoice = {}
for (const row of rows) {
  if (row['Merchant Name'] === 'Methyl-Life®') {
    const invoiceId = String(row['Invoice Number'])
    const amount = parseFloat(row['Invoice']) || 0
    const invoiceDate = row['Invoice Date']
    if (!byInvoice[invoiceId]) {
      byInvoice[invoiceId] = { amount: 0, date: invoiceDate }
    }
    byInvoice[invoiceId].amount += amount
  }
}

function excelDateToJS(serial) {
  const days = Math.floor(serial)
  const date = new Date((days - 25569) * 86400000)
  return date.toISOString().split('T')[0]
}

const sorted = Object.entries(byInvoice).sort((a, b) => parseInt(b[0]) - parseInt(a[0]))

for (const [id, data] of sorted) {
  const dateStr = data.date ? excelDateToJS(data.date) : 'unknown'
  const prefix = id.substring(0, 3)
  console.log(prefix + '* : ' + id + ' - $' + data.amount.toFixed(2) + ' - Invoice: ' + dateStr)
}
