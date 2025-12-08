/**
 * Check how many returns from transactions are missing from returns table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Count unique return IDs in transactions table
  const { data: returnTxs } = await supabase
    .from('transactions')
    .select('reference_id, client_id')
    .eq('reference_type', 'Return')

  const uniqueReturns = new Set(returnTxs?.map(t => t.reference_id))
  console.log('Unique return IDs in transactions:', uniqueReturns.size)

  // Check how many are in returns table
  const returnIds = Array.from(uniqueReturns).map(id => Number(id)).filter(id => id > 0)

  const { data: inReturnsTable } = await supabase
    .from('returns')
    .select('shipbob_return_id')
    .in('shipbob_return_id', returnIds.slice(0, 1000)) // Check first 1000

  const inTableSet = new Set(inReturnsTable?.map(r => String(r.shipbob_return_id)))

  const missing = returnIds.filter(id => !inTableSet.has(String(id)))

  console.log('Return IDs found in returns table:', inReturnsTable?.length || 0)
  console.log('Missing from returns table:', missing.length)
  console.log('Sample missing:', missing.slice(0, 10))
}
main().catch(console.error)
