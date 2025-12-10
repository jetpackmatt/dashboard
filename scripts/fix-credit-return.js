require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Fixing Credit Transaction (Return ID 2880370) ===\n')

  // Get the return info
  const { data: returnData } = await supabase
    .from('returns')
    .select('id, shipbob_return_id, client_id')
    .eq('shipbob_return_id', 2880370)
    .single()

  if (!returnData) {
    console.log('Return 2880370 not found!')
    return
  }

  console.log('Return found:', returnData.shipbob_return_id, '-> client_id:', returnData.client_id)

  // Get client's merchant_id
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .eq('id', returnData.client_id)
    .single()

  console.log('Client:', client?.company_name, '| merchant_id:', client?.merchant_id)

  // Update the Credit transaction
  const { error } = await supabase
    .from('transactions')
    .update({
      client_id: returnData.client_id,
      merchant_id: client?.merchant_id
    })
    .eq('transaction_id', '01KBKT20XZ6MH2J2PYXT8PYZT4')

  if (error) {
    console.log('Error:', error.message)
  } else {
    console.log('\n✅ Fixed Credit transaction -> Henson Shaving')
  }

  // Recheck unattributed count
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('merchant_id', null)

  console.log('\nRemaining unattributed transactions:', count)
}

main().catch(console.error)
