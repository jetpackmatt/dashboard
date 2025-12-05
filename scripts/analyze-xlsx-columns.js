#!/usr/bin/env node
/**
 * Analyze XLSX Files - Extract column headers and sample data
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const files = [
  'shipments.xlsx',
  'additional-services.xlsx',
  'returns.xlsx',
  'receiving.xlsx',
  'storage.xlsx',
  'credits.xlsx'
];

const dir = path.join(__dirname, '../reference/data/historic');

for (const file of files) {
  const filepath = path.join(dir, file);
  if (!fs.existsSync(filepath)) {
    console.log('\n=== ' + file + ' === NOT FOUND');
    continue;
  }

  console.log('\n' + '='.repeat(60));
  console.log(file.toUpperCase());
  console.log('='.repeat(60));

  const workbook = XLSX.readFile(filepath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Get headers (first row)
  const headers = data[0] || [];
  console.log('\nCOLUMNS (' + headers.length + '):');
  headers.forEach((h, i) => console.log('  ' + (i+1) + '. ' + h));

  // Show row count
  console.log('\nROW COUNT: ' + (data.length - 1));

  // Show sample row
  if (data.length > 1) {
    console.log('\nSAMPLE ROW 1:');
    const sampleRow = data[1];
    headers.forEach((h, i) => {
      const val = sampleRow[i];
      const display = val !== undefined ? String(val).substring(0, 80) : '(empty)';
      console.log('  ' + h + ': ' + display);
    });
  }
}
