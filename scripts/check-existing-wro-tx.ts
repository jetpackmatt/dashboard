#!/usr/bin/env npx tsx
/**
 * Check existing WRO transaction columns
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Get one existing WRO transaction to see the column structure
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_type', 'WRO')
    .limit(1)

  if (error) {
    console.error('Error:', error)
    return
  }

  if (data && data.length > 0) {
    console.log('Example WRO transaction columns:')
    console.log(JSON.stringify(data[0], null, 2))
  } else {
    console.log('No WRO transactions found')
  }
}

main()
