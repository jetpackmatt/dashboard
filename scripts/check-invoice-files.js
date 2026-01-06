#!/usr/bin/env node

/**
 * Check file timestamps in Supabase storage for a specific invoice
 * Usage: node scripts/check-invoice-files.js JPHS-0023
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceNumber = process.argv[2] || 'JPHS-0023'

  console.log(`\n=== Checking files for invoice ${invoiceNumber} ===\n`)

  // First, get the invoice record from DB to find client_id and paths
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select('id, client_id, invoice_number, pdf_path, xlsx_path, generated_at, version, status')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError?.message || 'No data')
    return
  }

  console.log('Invoice DB record:')
  console.log('  ID:', invoice.id)
  console.log('  Status:', invoice.status)
  console.log('  Version:', invoice.version)
  console.log('  Generated at:', invoice.generated_at)
  console.log('  PDF path:', invoice.pdf_path)
  console.log('  XLSX path:', invoice.xlsx_path)

  // List files in the storage folder
  const folderPath = `${invoice.client_id}/${invoice.invoice_number}`
  console.log(`\n=== Storage folder: ${folderPath} ===\n`)

  const { data: files, error: listError } = await supabase.storage
    .from('invoices')
    .list(folderPath, { limit: 100 })

  if (listError) {
    console.error('Error listing files:', listError.message)
    return
  }

  if (!files || files.length === 0) {
    console.log('No files found in storage folder!')
    return
  }

  console.log(`Found ${files.length} files:\n`)

  for (const file of files) {
    console.log(`📄 ${file.name}`)
    console.log(`   ID: ${file.id}`)
    console.log(`   Created: ${file.created_at}`)
    console.log(`   Updated: ${file.updated_at}`)
    console.log(`   Size: ${file.metadata?.size ? Math.round(file.metadata.size / 1024) : '?'} KB`)
    console.log(`   Content-Type: ${file.metadata?.mimetype || 'unknown'}`)
    console.log()
  }

  // Generate signed URLs and show them
  console.log('=== Signed URLs ===\n')

  const pdfPath = invoice.pdf_path || `${folderPath}/${invoiceNumber}.pdf`
  const xlsxPath = invoice.xlsx_path || `${folderPath}/${invoiceNumber}-details.xlsx`

  const { data: pdfUrl } = await supabase.storage
    .from('invoices')
    .createSignedUrl(pdfPath, 3600)

  const { data: xlsxUrl } = await supabase.storage
    .from('invoices')
    .createSignedUrl(xlsxPath, 3600)

  console.log('PDF URL (valid 1 hour):')
  console.log(pdfUrl?.signedUrl || 'Not available')
  console.log()
  console.log('XLSX URL (valid 1 hour):')
  console.log(xlsxUrl?.signedUrl || 'Not available')
}

main().catch(console.error)
