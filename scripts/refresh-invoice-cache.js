#!/usr/bin/env node

/**
 * Re-upload invoice files to bust CDN cache
 * Downloads from storage and re-uploads with no-cache headers
 *
 * Usage: node scripts/refresh-invoice-cache.js JPHS-0042-010526
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceNumber = process.argv[2]

  if (!invoiceNumber) {
    console.error('Usage: node scripts/refresh-invoice-cache.js <invoice_number>')
    process.exit(1)
  }

  console.log(`\n=== Refreshing cache for invoice ${invoiceNumber} ===\n`)

  // Get invoice record
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select('id, client_id, invoice_number, pdf_path, xlsx_path')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError?.message || 'No data')
    return
  }

  const pdfPath = invoice.pdf_path
  const xlsxPath = invoice.xlsx_path

  if (!pdfPath || !xlsxPath) {
    console.error('Invoice has no file paths stored')
    return
  }

  // Download current files
  console.log('Downloading current files...')

  const { data: pdfData, error: pdfDownloadError } = await supabase.storage
    .from('invoices')
    .download(pdfPath)

  if (pdfDownloadError) {
    console.error('Error downloading PDF:', pdfDownloadError.message)
    return
  }

  const { data: xlsxData, error: xlsxDownloadError } = await supabase.storage
    .from('invoices')
    .download(xlsxPath)

  if (xlsxDownloadError) {
    console.error('Error downloading XLSX:', xlsxDownloadError.message)
    return
  }

  console.log('  PDF size:', Math.round(pdfData.size / 1024), 'KB')
  console.log('  XLSX size:', Math.round(xlsxData.size / 1024), 'KB')

  // Delete existing files
  console.log('\nDeleting existing files...')

  const { error: deleteError } = await supabase.storage
    .from('invoices')
    .remove([pdfPath, xlsxPath])

  if (deleteError) {
    console.error('Error deleting files:', deleteError.message)
    return
  }

  console.log('  Deleted successfully')

  // Re-upload with no-cache headers
  console.log('\nRe-uploading with no-cache headers...')

  const pdfBuffer = Buffer.from(await pdfData.arrayBuffer())
  const xlsxBuffer = Buffer.from(await xlsxData.arrayBuffer())

  const { error: pdfUploadError } = await supabase.storage
    .from('invoices')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      cacheControl: 'no-cache, no-store, must-revalidate',
    })

  if (pdfUploadError) {
    console.error('Error uploading PDF:', pdfUploadError.message)
    return
  }

  const { error: xlsxUploadError } = await supabase.storage
    .from('invoices')
    .upload(xlsxPath, xlsxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      cacheControl: 'no-cache, no-store, must-revalidate',
    })

  if (xlsxUploadError) {
    console.error('Error uploading XLSX:', xlsxUploadError.message)
    return
  }

  console.log('  Uploaded successfully')

  console.log('\n✅ Cache refreshed! Files should now be accessible without caching.')
}

main().catch(console.error)
