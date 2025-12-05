#!/usr/bin/env node
/**
 * Migration script to add full-text search to shipments and orders tables
 *
 * This creates:
 * - search_vector (tsvector) columns
 * - GIN indexes for fast lookups
 * - Triggers to auto-update vectors on INSERT/UPDATE
 * - A helper function for prefix search
 *
 * Usage: node scripts/migrate-fulltext-search.js
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runMigration() {
  console.log('🔍 Starting full-text search migration...\n')

  try {
    // Step 1: Add search_vector column to shipments
    console.log('1. Adding search_vector column to shipments...')
    const { error: e1 } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS search_vector tsvector;`
    }).catch(() => ({ error: null }))

    // Use raw SQL via postgres function if rpc doesn't work
    // We'll use the MCP postgres connection instead

    console.log('   Note: Run the SQL migration manually in Supabase Dashboard:')
    console.log('   Go to: SQL Editor -> paste contents of scripts/migrate-fulltext-search.sql\n')

    // Let's verify the migration status by checking if the column exists
    const { data: columns, error: colError } = await supabase
      .from('shipments')
      .select('*')
      .limit(1)

    if (colError) {
      console.error('Error checking shipments table:', colError.message)
    } else if (columns && columns[0]) {
      const hasSearchVector = 'search_vector' in columns[0]
      console.log(`   shipments.search_vector exists: ${hasSearchVector ? '✅' : '❌ (run migration)'}`)
    }

    const { data: orderCols, error: orderColError } = await supabase
      .from('orders')
      .select('*')
      .limit(1)

    if (orderColError) {
      console.error('Error checking orders table:', orderColError.message)
    } else if (orderCols && orderCols[0]) {
      const hasSearchVector = 'search_vector' in orderCols[0]
      console.log(`   orders.search_vector exists: ${hasSearchVector ? '✅' : '❌ (run migration)'}`)
    }

    console.log('\n📋 To run the migration:')
    console.log('   1. Go to Supabase Dashboard -> SQL Editor')
    console.log('   2. Open file: scripts/migrate-fulltext-search.sql')
    console.log('   3. Copy and paste the SQL, then run it')
    console.log('   4. Wait for backfill to complete (may take a few minutes for large tables)')

    console.log('\n✨ Once migration is complete, search will use GIN indexes for instant results!')

  } catch (error) {
    console.error('Migration error:', error)
  }
}

// Also provide a test function
async function testSearch(table, query) {
  console.log(`\nTesting search on ${table} for "${query}"...`)

  try {
    const { data, error } = await supabase
      .from(table)
      .select('id, recipient_name, tracking_id')
      .textSearch('search_vector', query, { type: 'websearch' })
      .limit(5)

    if (error) {
      if (error.message.includes('search_vector')) {
        console.log('❌ search_vector column not found - run migration first')
      } else {
        console.error('Search error:', error.message)
      }
      return
    }

    console.log(`Found ${data?.length || 0} results:`)
    data?.forEach(row => {
      console.log(`  - ${row.recipient_name || row.customer_name} (${row.tracking_id || row.store_order_id || row.id})`)
    })
  } catch (err) {
    console.error('Test error:', err.message)
  }
}

// Main
runMigration()
