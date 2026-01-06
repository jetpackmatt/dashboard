#!/usr/bin/env node
/**
 * Fix Ontario 6 (CA) - it's California, not Canada
 * Also add any missing FCs
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fix() {
  // Fix Ontario 6 (CA) - it's California, not Canada
  const { error } = await supabase
    .from('fulfillment_centers')
    .update({
      country: 'US',
      state_province: 'CA',
      tax_rate: null,
      tax_type: null
    })
    .eq('name', 'Ontario 6 (CA)')

  if (error) {
    console.error('Error fixing Ontario 6:', error)
  } else {
    console.log('✅ Fixed Ontario 6 (CA) → US (California)')
  }

  // Now add any missing FCs (Brampton, etc) - use pagination for large tables
  const allFCNames = new Set()
  const pageSize = 1000
  let lastId = null

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, fulfillment_center')
      .not('fulfillment_center', 'is', null)
      .order('transaction_id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('transaction_id', lastId)
    }

    const { data: page } = await query
    if (!page || page.length === 0) break

    page.forEach(tx => allFCNames.add(tx.fulfillment_center))
    lastId = page[page.length - 1].transaction_id

    if (page.length < pageSize) break
  }

  const uniqueFCs = [...allFCNames]

  const { data: existing } = await supabase
    .from('fulfillment_centers')
    .select('name')

  const existingNames = new Set(existing?.map(f => f.name) || [])
  const newFCs = uniqueFCs.filter(name => !existingNames.has(name))

  if (newFCs.length > 0) {
    console.log('Adding missing FCs:', newFCs)
    for (const name of newFCs) {
      // Detect location - check for US state first
      const stateMatch = name.match(/\(([A-Z]{2})\)/)
      const US_STATES = ['CA','WI','PA','NJ','IL','TX','GA','OH','NY','FL','AZ','CO','WA','OR','MA','MD','VA','NC','TN','MI','IN','MO','SC','AL','KY','LA','OK','CT','UT','NV','NM','KS','AR','MS','NE','ID','WV','HI','NH','ME','MT','RI','DE','SD','ND','AK','VT','WY','DC']
      const isUSState = stateMatch && US_STATES.includes(stateMatch[1])

      // Canadian = has full province name in parens like "(Ontario)"
      const isCanadian = /\(Ontario\)/i.test(name)

      const record = {
        name,
        country: isCanadian ? 'CA' : 'US',
        state_province: isCanadian ? 'Ontario' : (stateMatch ? stateMatch[1] : null),
        tax_rate: isCanadian ? 13 : null,
        tax_type: isCanadian ? 'HST' : null,
        auto_detected: true
      }

      console.log('  ' + (isCanadian ? '🍁' : '🇺🇸') + ' ' + name + ' → ' + record.country + ' (' + (record.state_province || 'unknown') + ')')

      await supabase.from('fulfillment_centers').upsert(record, { onConflict: 'name' })
    }
  } else {
    console.log('No missing FCs to add')
  }

  // Show final state
  const { data: all } = await supabase
    .from('fulfillment_centers')
    .select('*')
    .order('country', { ascending: false })
    .order('name')

  console.log('\n=== All Fulfillment Centers ===')
  console.log('Country | State/Province | Tax Rate | Name')
  console.log('-'.repeat(70))
  for (const fc of all || []) {
    const taxInfo = fc.tax_rate ? fc.tax_rate + '% ' + fc.tax_type : '-'
    console.log('   ' + fc.country + '   |    ' + (fc.state_province || '-').padEnd(10) + ' |  ' + taxInfo.padEnd(12) + ' | ' + fc.name)
  }
}

fix().catch(console.error)
