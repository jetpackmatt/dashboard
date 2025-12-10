require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Fixing Payment & CC Processing Fee Attribution ===\n')

  // Find ShipBob Payments and Jetpack Costs clients
  const { data: shipbobPayments } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .eq('company_name', 'ShipBob Payments')
    .single()

  const { data: jetpackCosts } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .eq('company_name', 'Jetpack Costs')
    .single()

  console.log('ShipBob Payments:', shipbobPayments?.id || 'NOT FOUND')
  console.log('Jetpack Costs:', jetpackCosts?.id || 'NOT FOUND')

  if (!shipbobPayments || !jetpackCosts) {
    console.log('\nMissing system clients. Cannot fix attribution.')
    return
  }

  // Fix Payment transactions -> ShipBob Payments
  const { data: paymentTxs } = await supabase
    .from('transactions')
    .select('transaction_id')
    .is('merchant_id', null)
    .eq('reference_type', 'Default')
    .eq('fee_type', 'Payment')

  console.log('\nPayment transactions to fix:', paymentTxs?.length || 0)

  if (paymentTxs && paymentTxs.length > 0) {
    const { error: paymentError } = await supabase
      .from('transactions')
      .update({
        client_id: shipbobPayments.id,
        merchant_id: shipbobPayments.merchant_id || 'ShipBob'
      })
      .is('merchant_id', null)
      .eq('reference_type', 'Default')
      .eq('fee_type', 'Payment')

    if (paymentError) {
      console.log('Error fixing payments:', paymentError.message)
    } else {
      console.log('✅ Fixed', paymentTxs.length, 'Payment transactions -> ShipBob Payments')
    }
  }

  // Fix CC Processing Fee transactions -> Jetpack Costs
  const { data: ccTxs } = await supabase
    .from('transactions')
    .select('transaction_id')
    .is('merchant_id', null)
    .eq('reference_type', 'Default')
    .eq('fee_type', 'Credit Card Processing Fee')

  console.log('\nCC Processing Fee transactions to fix:', ccTxs?.length || 0)

  if (ccTxs && ccTxs.length > 0) {
    const { error: ccError } = await supabase
      .from('transactions')
      .update({
        client_id: jetpackCosts.id,
        merchant_id: jetpackCosts.merchant_id || 'Jetpack'
      })
      .is('merchant_id', null)
      .eq('reference_type', 'Default')
      .eq('fee_type', 'Credit Card Processing Fee')

    if (ccError) {
      console.log('Error fixing CC fees:', ccError.message)
    } else {
      console.log('✅ Fixed', ccTxs.length, 'CC Processing Fee transactions -> Jetpack Costs')
    }
  }

  // Recheck unattributed count
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('merchant_id', null)

  console.log('\n=== Remaining unattributed transactions:', count)
}

main().catch(console.error)
