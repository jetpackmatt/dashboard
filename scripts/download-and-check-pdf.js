#!/usr/bin/env node

/**
 * Download PDF from Supabase and save locally to check contents
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceNumber = process.argv[2] || 'JPHS-0042-010526'

  console.log(`\n=== Downloading ${invoiceNumber} ===\n`)

  // Get invoice record
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('id, client_id, invoice_number, pdf_path, total_amount')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (!invoice) {
    console.error('Invoice not found')
    return
  }

  console.log('Invoice total_amount from DB:', invoice.total_amount)
  console.log('PDF path:', invoice.pdf_path)

  // Download the PDF
  const { data, error } = await supabase.storage
    .from('invoices')
    .download(invoice.pdf_path)

  if (error) {
    console.error('Download error:', error.message)
    return
  }

  // Save to local file
  const localPath = `/tmp/${invoiceNumber}.pdf`
  const buffer = Buffer.from(await data.arrayBuffer())
  fs.writeFileSync(localPath, buffer)

  console.log(`\nSaved to: ${localPath}`)
  console.log(`File size: ${Math.round(buffer.length / 1024)} KB`)
  console.log('\nOpen with: open', localPath)
}

main().catch(console.error)
