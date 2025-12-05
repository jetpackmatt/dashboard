#!/usr/bin/env node
/**
 * Run migration 009: Billing & Invoicing System
 *
 * This script reads the SQL migration file and executes it against Supabase
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runMigration() {
  console.log('=== Running Migration 009: Billing & Invoicing System ===\n')

  // Read the SQL file
  const sqlPath = path.join(__dirname, '009-billing-invoicing-system.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')

  // Split into individual statements (simple split on semicolons followed by newlines)
  // Filter out comments and empty statements
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && s.length > 10)

  console.log(`Found ${statements.length} SQL statements to execute\n`)

  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]

    // Get first line for logging
    const firstLine = statement.split('\n')[0].substring(0, 60)

    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' })

      if (error) {
        // Try direct query for DDL statements
        const { error: directError } = await supabase.from('_migrations').select('*').limit(0)
        throw new Error(error.message)
      }

      console.log(`✓ [${i + 1}/${statements.length}] ${firstLine}...`)
      successCount++
    } catch (err) {
      console.log(`✗ [${i + 1}/${statements.length}] ${firstLine}...`)
      console.log(`  Error: ${err.message}\n`)
      errorCount++
    }
  }

  console.log(`\n=== Migration Complete ===`)
  console.log(`Success: ${successCount}, Errors: ${errorCount}`)
}

// Alternative: Run via psql if available
async function runViaPsql() {
  const { execSync } = require('child_process')

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    console.log('No DATABASE_URL found, cannot run via psql')
    return false
  }

  const sqlPath = path.join(__dirname, '009-billing-invoicing-system.sql')

  try {
    console.log('Running migration via psql...\n')
    execSync(`psql "${dbUrl}" -f "${sqlPath}"`, { stdio: 'inherit' })
    return true
  } catch (err) {
    console.error('psql execution failed:', err.message)
    return false
  }
}

// Main
async function main() {
  // Try psql first (more reliable for DDL)
  const psqlSuccess = await runViaPsql()

  if (!psqlSuccess) {
    console.log('\nFalling back to Supabase client...')
    console.log('Note: For DDL statements, running via Supabase Dashboard SQL Editor is recommended.\n')
    // await runMigration()  // This won't work for DDL, just informational
    console.log('Please run the migration SQL in Supabase Dashboard > SQL Editor')
    console.log(`File: ${path.join(__dirname, '009-billing-invoicing-system.sql')}`)
  }
}

main().catch(console.error)
