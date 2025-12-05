#!/usr/bin/env node
/**
 * Create the 'invoices' storage bucket in Supabase
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  console.log('=== Creating Invoices Storage Bucket ===\n')

  // First, list existing buckets
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()

  if (listError) {
    console.error('Error listing buckets:', listError)
    process.exit(1)
  }

  console.log('Existing buckets:', buckets.map(b => b.name).join(', ') || '(none)')

  // Check if invoices bucket exists
  const invoicesBucket = buckets.find(b => b.name === 'invoices')

  if (invoicesBucket) {
    console.log('\n✓ "invoices" bucket already exists')
    console.log('  Created:', invoicesBucket.created_at)
    console.log('  Public:', invoicesBucket.public)
  } else {
    // Create the bucket
    console.log('\nCreating "invoices" bucket...')

    const { data, error } = await supabase.storage.createBucket('invoices', {
      public: false, // Private bucket - requires auth to access
      fileSizeLimit: 10485760, // 10MB max file size
      allowedMimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ]
    })

    if (error) {
      console.error('Error creating bucket:', error)
      process.exit(1)
    }

    console.log('✓ Bucket created successfully:', data)
  }

  // Test upload capability
  console.log('\nTesting upload capability...')
  const testContent = Buffer.from('test')
  const testPath = '_test/test.txt'

  const { error: uploadError } = await supabase.storage
    .from('invoices')
    .upload(testPath, testContent, {
      contentType: 'text/plain',
      upsert: true
    })

  if (uploadError) {
    console.error('Upload test failed:', uploadError)
  } else {
    console.log('✓ Upload test successful')

    // Clean up test file
    await supabase.storage.from('invoices').remove([testPath])
    console.log('✓ Test file cleaned up')
  }

  console.log('\n=== Done ===')
}

main().catch(console.error)
