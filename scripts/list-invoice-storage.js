#!/usr/bin/env node

/**
 * List all files in the Supabase 'invoices' storage bucket
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function listInvoiceStorage() {
  console.log('Listing files in invoices bucket...\n')

  // List root folders (client IDs)
  const { data: folders, error: foldersError } = await supabase.storage
    .from('invoices')
    .list('', { limit: 100 })

  if (foldersError) {
    console.error('Error listing folders:', foldersError)
    return
  }

  console.log(`Found ${folders.length} root items:\n`)

  // These are client ID folders - list their contents
  for (const folder of folders) {
    console.log(`\n📁 ${folder.name}/ (Client folder)`)

    const { data: invoiceFolders, error: subError } = await supabase.storage
      .from('invoices')
      .list(folder.name, { limit: 200 })

    if (subError) {
      console.log(`   Error: ${subError.message}`)
      continue
    }

    console.log(`   Found ${invoiceFolders?.length || 0} invoice folders`)

    for (const invoiceFolder of invoiceFolders || []) {
      const { data: files, error: filesError } = await supabase.storage
        .from('invoices')
        .list(`${folder.name}/${invoiceFolder.name}`, { limit: 100 })

      if (!filesError && files && files.length > 0) {
        console.log(`   📁 ${invoiceFolder.name}/`)
        for (const file of files) {
          const size = file.metadata?.size ? Math.round(file.metadata.size / 1024) : '?'
          console.log(`      📄 ${file.name} (${size} KB)`)
        }
      }
    }
  }
}

listInvoiceStorage().catch(console.error)
