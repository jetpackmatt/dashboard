/**
 * Fix Methyl-Life Per Pick Fee markup rule
 * Change from flat $0.04 to percentage 15.3846% (same as Henson)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const METHYL_CLIENT_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'
const PER_PICK_RULE_ID = 'b759cd8b-182f-441f-ad61-a10910134bc6'

async function main() {
  console.log('=== Fix Methyl-Life Per Pick Fee Markup ===\n')

  // Update to percentage-based (same as Henson)
  const { data, error } = await supabase
    .from('markup_rules')
    .update({
      markup_type: 'percentage',
      markup_value: '15.3846',
      updated_at: new Date().toISOString()
    })
    .eq('id', PER_PICK_RULE_ID)
    .eq('client_id', METHYL_CLIENT_ID)
    .select()

  if (error) {
    console.error('Error updating rule:', error.message)
    return
  }

  console.log('Updated Per Pick Fee rule:')
  console.log('  markup_type: percentage')
  console.log('  markup_value: 15.3846%')
  console.log('\nNow regenerate JPML-0021 in the admin UI to apply new markup.')
}

main().catch(console.error)
