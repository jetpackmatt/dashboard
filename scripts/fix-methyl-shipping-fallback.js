/**
 * Fix Methyl-Life Shipping fallback markup rule
 * Change from 35% to 40% (to match reference and ship_option 146 rule)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const METHYL_CLIENT_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'

async function main() {
  console.log('=== Fix Methyl-Life Shipping Fallback Markup ===\n')

  // Find the fallback Standard rule (ship_option_id IS NULL)
  const { data: rules, error: fetchError } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('client_id', METHYL_CLIENT_ID)
    .eq('fee_type', 'Standard')
    .is('ship_option_id', null)

  if (fetchError) {
    console.error('Error fetching rules:', fetchError.message)
    return
  }

  if (!rules || rules.length === 0) {
    console.log('No fallback Standard rule found')
    return
  }

  console.log('Found fallback rule:')
  console.log('  ID:', rules[0].id)
  console.log('  Name:', rules[0].name)
  console.log('  Current markup:', rules[0].markup_value + '%')

  // Update to 40%
  const { data, error } = await supabase
    .from('markup_rules')
    .update({
      markup_value: '40.0000',
      description: 'Fallback for any shipping without specific ship_option rule - same as ship_option 146',
      updated_at: new Date().toISOString()
    })
    .eq('id', rules[0].id)
    .select()

  if (error) {
    console.error('Error updating rule:', error.message)
    return
  }

  console.log('\nUpdated to:')
  console.log('  markup_value: 40%')
  console.log('\nNow regenerate JPML-0021 in the admin UI to apply new markup.')
  console.log('Expected result: Shipping total should match reference $3,885.54')
}

main().catch(console.error)
