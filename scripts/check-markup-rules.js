/**
 * Check current markup rules for Henson
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name')
    .ilike('company_name', '%henson%')
    .single()

  console.log('Client:', henson.company_name)
  console.log('')

  const { data: rules } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .or(`client_id.is.null,client_id.eq.${henson.id}`)
    .order('billing_category')
    .order('fee_type')

  console.log('Active Markup Rules:')
  console.log('='.repeat(90))

  for (const r of rules || []) {
    const scope = r.client_id ? 'Henson' : 'Global'
    const conditions = []
    if (r.ship_option_id) conditions.push('Ship ' + r.ship_option_id)
    if (r.conditions && r.conditions.weight_min_oz !== undefined) {
      conditions.push(r.conditions.weight_min_oz + '-' + (r.conditions.weight_max_oz || '+') + 'oz')
    }
    const condStr = conditions.length > 0 ? ' (' + conditions.join(', ') + ')' : ''

    const cat = (r.billing_category || 'any').padEnd(15)
    const fee = (r.fee_type || 'any').padEnd(25)
    const cond = condStr.padEnd(20)
    const markup = r.markup_type === 'percentage'
      ? r.markup_value + '%'
      : '$' + r.markup_value.toFixed(2)

    console.log(`[${scope.padEnd(6)}] ${cat} | ${fee}${cond} -> ${markup}`)
  }
}

main().catch(console.error)
