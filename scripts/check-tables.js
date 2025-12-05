#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkTables() {
  console.log('Checking if tables exist...\n')

  const tables = ['products', 'returns', 'receiving_orders']

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('id').limit(1)
    if (error && error.code === '42P01') {
      console.log(`  ${table}: NOT EXISTS`)
    } else if (error) {
      console.log(`  ${table}: ERROR - ${error.message}`)
    } else {
      console.log(`  ${table}: EXISTS`)
    }
  }
}

checkTables()
