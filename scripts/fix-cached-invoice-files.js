#!/usr/bin/env node

/**
 * Fix cached invoice files by uploading to versioned paths
 * This bypasses CDN caching by using a new filename
 *
 * Usage: node scripts/fix-cached-invoice-files.js JPHS-0042-010526
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
    console.error('Usage: node scripts/fix-cached-invoice-files.js <invoice_number>')
    process.exit(1)
  }

  console.log(`\n=== Fixing cached files for ${invoiceNumber} ===\n`)

  // Get invoice record
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select('id, client_id, invoice_number, pdf_path, xlsx_path, version')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError?.message || 'No data')
    return
  }

  console.log('Current version:', invoice.version)
  console.log('Current PDF path:', invoice.pdf_path)
  console.log('Current XLSX path:', invoice.xlsx_path)

  // Download current files using .download() which bypasses CDN
  console.log('\nDownloading current files (bypassing CDN)...')

  const { data: pdfData, error: pdfDownloadError } = await supabase.storage
    .from('invoices')
    .download(invoice.pdf_path)

  if (pdfDownloadError) {
    console.error('Error downloading PDF:', pdfDownloadError.message)
    return
  }

  const { data: xlsxData, error: xlsxDownloadError } = await supabase.storage
    .from('invoices')
    .download(invoice.xlsx_path)

  if (xlsxDownloadError) {
    console.error('Error downloading XLSX:', xlsxDownloadError.message)
    return
  }

  console.log('  PDF size:', Math.round(pdfData.size / 1024), 'KB')
  console.log('  XLSX size:', Math.round(xlsxData.size / 1024), 'KB')

  // Create new versioned paths
  const version = invoice.version || 1
  const versionSuffix = version > 1 ? `-v${version}` : ''
  const newPdfPath = `${invoice.client_id}/${invoiceNumber}/${invoiceNumber}${versionSuffix}.pdf`
  const newXlsxPath = `${invoice.client_id}/${invoiceNumber}/${invoiceNumber}${versionSuffix}-details.xlsx`

  // Check if new paths are same as old (already versioned)
  if (newPdfPath === invoice.pdf_path) {
    console.log('\nFiles are already using versioned paths.')
    console.log('Adding timestamp to bust cache...')
    // Add timestamp to force new path
    const timestamp = Date.now()
    const newPdfPathWithTimestamp = `${invoice.client_id}/${invoiceNumber}/${invoiceNumber}${versionSuffix}-${timestamp}.pdf`
    const newXlsxPathWithTimestamp = `${invoice.client_id}/${invoiceNumber}/${invoiceNumber}${versionSuffix}-${timestamp}-details.xlsx`

    console.log('\nNew PDF path:', newPdfPathWithTimestamp)
    console.log('New XLSX path:', newXlsxPathWithTimestamp)

    // Upload to new paths with timestamp
    const pdfBuffer = Buffer.from(await pdfData.arrayBuffer())
    const xlsxBuffer = Buffer.from(await xlsxData.arrayBuffer())

    const { error: pdfUploadError } = await supabase.storage
      .from('invoices')
      .upload(newPdfPathWithTimestamp, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: 'no-cache, no-store, must-revalidate',
      })

    if (pdfUploadError) {
      console.error('Error uploading PDF:', pdfUploadError.message)
      return
    }

    const { error: xlsxUploadError } = await supabase.storage
      .from('invoices')
      .upload(newXlsxPathWithTimestamp, xlsxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        cacheControl: 'no-cache, no-store, must-revalidate',
      })

    if (xlsxUploadError) {
      console.error('Error uploading XLSX:', xlsxUploadError.message)
      return
    }

    // Update DB with new paths
    const { error: updateError } = await supabase
      .from('invoices_jetpack')
      .update({
        pdf_path: newPdfPathWithTimestamp,
        xlsx_path: newXlsxPathWithTimestamp,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoice.id)

    if (updateError) {
      console.error('Error updating DB:', updateError.message)
      return
    }

    console.log('\n✅ Files uploaded to new timestamped paths and DB updated!')
    return
  }

  console.log('\nNew PDF path:', newPdfPath)
  console.log('New XLSX path:', newXlsxPath)

  // Upload to versioned paths
  console.log('\nUploading to versioned paths...')

  const pdfBuffer = Buffer.from(await pdfData.arrayBuffer())
  const xlsxBuffer = Buffer.from(await xlsxData.arrayBuffer())

  const { error: pdfUploadError } = await supabase.storage
    .from('invoices')
    .upload(newPdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      cacheControl: 'no-cache, no-store, must-revalidate',
    })

  if (pdfUploadError) {
    console.error('Error uploading PDF:', pdfUploadError.message)
    return
  }

  const { error: xlsxUploadError } = await supabase.storage
    .from('invoices')
    .upload(newXlsxPath, xlsxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      cacheControl: 'no-cache, no-store, must-revalidate',
    })

  if (xlsxUploadError) {
    console.error('Error uploading XLSX:', xlsxUploadError.message)
    return
  }

  // Update DB with new paths
  const { error: updateError } = await supabase
    .from('invoices_jetpack')
    .update({
      pdf_path: newPdfPath,
      xlsx_path: newXlsxPath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoice.id)

  if (updateError) {
    console.error('Error updating DB:', updateError.message)
    return
  }

  console.log('\n✅ Files uploaded to versioned paths and DB updated!')
  console.log('\nYou can now download from Supabase dashboard - the new paths will not be cached.')
}

main().catch(console.error)
