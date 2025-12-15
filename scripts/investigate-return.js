/**
 * Investigate unattributed Return transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function investigate() {
  console.log('=== ALL UNATTRIBUTED RETURN TRANSACTIONS ===\n')

  const { data: unattributed } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type, amount, invoiced_date, fc_name')
    .eq('reference_type', 'Return')
    .is('client_id', null)
    .order('invoiced_date', { ascending: false })

  console.log(`Found ${unattributed?.length || 0} unattributed return transactions:\n`)

  for (const tx of unattributed || []) {
    console.log(`  ${tx.reference_id}: ${tx.fee_type} | $${tx.amount} | ${tx.invoiced_date} | ${tx.fc_name}`)
  }

  // Test API calls for each return ID
  const parentToken = process.env.SHIPBOB_API_TOKEN

  console.log('\n=== CHECKING API FOR EACH RETURN ID ===\n')

  for (const tx of unattributed || []) {
    const returnId = tx.reference_id
    try {
      const res = await fetch(`https://api.shipbob.com/1.0/return/${returnId}`, {
        headers: { Authorization: `Bearer ${parentToken}` }
      })
      if (res.ok) {
        const data = await res.json()
        console.log(`  ${returnId}: ✅ Found - status=${data.status}, shipment=${data.original_shipment_id}`)
      } else {
        console.log(`  ${returnId}: ❌ ${res.status} ${res.statusText}`)
      }
    } catch (e) {
      console.log(`  ${returnId}: ❌ Error: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 100))
  }

  // Check what OTHER returns look like (ones that do have client_id)
  console.log('\n=== SAMPLE OF ATTRIBUTED RETURN TRANSACTIONS ===\n')

  const { data: attributed } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type, amount, invoiced_date, client_id')
    .eq('reference_type', 'Return')
    .not('client_id', 'is', null)
    .order('invoiced_date', { ascending: false })
    .limit(5)

  for (const tx of attributed || []) {
    console.log(`  ${tx.reference_id}: ${tx.fee_type} | $${tx.amount} | ${tx.invoiced_date}`)

    // Check if this return exists in API
    const res = await fetch(`https://api.shipbob.com/1.0/return/${tx.reference_id}`, {
      headers: { Authorization: `Bearer ${parentToken}` }
    })
    if (res.ok) {
      const data = await res.json()
      console.log(`    API: ✅ Found - status=${data.status}, shipment=${data.original_shipment_id}`)
    } else {
      console.log(`    API: ❌ ${res.status}`)
    }

    // Check if in returns table
    const { data: returnRecord } = await supabase
      .from('returns')
      .select('shipbob_return_id, status, original_shipment_id')
      .eq('shipbob_return_id', Number(tx.reference_id))
      .maybeSingle()

    if (returnRecord) {
      console.log(`    DB: ✅ In returns table - status=${returnRecord.status}, shipment=${returnRecord.original_shipment_id}`)
    } else {
      console.log(`    DB: ❌ Not in returns table`)
    }
    await new Promise(r => setTimeout(r, 100))
  }
}

investigate().catch(console.error)
