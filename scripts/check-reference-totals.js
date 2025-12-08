#!/usr/bin/env node
/**
 * Check reference XLSX totals
 */
const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx');

  const sheets = ['Shipments', 'Additional Services', 'Returns', 'Receiving', 'Storage', 'Credits'];

  for (const name of sheets) {
    const sheet = wb.getWorksheet(name);
    if (!sheet) continue;

    // Get headers
    const headers = [];
    sheet.getRow(1).eachCell((cell, idx) => {
      headers[idx] = String(cell.value || '');
    });

    // Find amount columns
    const amountCols = [];
    headers.forEach((h, i) => {
      if (h.includes('Invoice') || h.includes('Surcharge') || h.includes('Fulfillment') ||
          h.includes('Insurance') || h.includes('Amount') || h.includes('Credit')) {
        amountCols.push({ idx: i, name: h });
      }
    });

    console.log('=== ' + name + ' ===');
    console.log('Amount columns: ' + amountCols.map(c => c.name).join(', '));

    // Get Total row
    const lastRow = sheet.rowCount;
    const totalRow = sheet.getRow(lastRow);

    console.log('Total row values:');
    for (const col of amountCols) {
      const val = totalRow.getCell(col.idx).value;
      if (typeof val === 'number') {
        console.log('  ' + col.name + ': $' + val.toFixed(2));
      }
    }
    console.log('');
  }
}

main().catch(console.error);
