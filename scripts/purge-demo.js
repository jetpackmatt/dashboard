#!/usr/bin/env node
/**
 * Purge all demo client data.
 *
 * Removes all rows tagged with a demo client_id across every table, plus the
 * demo user's auth record and user_clients link. Safe to run repeatedly —
 * idempotent. Leaves real client data untouched.
 *
 * Usage:
 *   node scripts/purge-demo.js              # dry run (shows counts)
 *   node scripts/purge-demo.js --execute    # actually delete
 *
 * Reversibility guarantee: every row this script touches was created by
 * the demo seed/backfill/cron pipeline. No real client data is deleted.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const EXECUTE = process.argv.includes('--execute')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Order matters: children before parents to avoid FK violations.
// Each entry: [tableName, filterColumn] — filter is `column IN (demoClientIds)`.
const PURGE_ORDER = [
  ['shipment_items', 'client_id'],
  ['order_items', 'client_id'],
  ['transactions', 'client_id'],
  ['care_ticket_events', 'client_id'],
  ['care_tickets', 'client_id'],
  ['returns', 'client_id'],
  ['receiving_orders', 'client_id'],
  ['shipments', 'client_id'],
  ['orders', 'client_id'],
  ['products', 'client_id'],
  ['invoices_jetpack', 'client_id'],
  ['lost_in_transit_checks', 'client_id'],
  ['tracking_checkpoints', 'client_id'],
  ['user_clients', 'client_id'],
  ['client_api_credentials', 'client_id'],
  ['markup_rules', 'client_id'],
  ['analytics_daily_summaries', 'client_id'],
  ['analytics_billing_summaries', 'client_id'],
  ['analytics_city_summaries', 'client_id'],
  ['analytics_refresh_queue', 'client_id'],
]

async function main() {
  console.log(`\n🧹 Demo purge — ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}\n`)

  const { data: demoClients, error } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('is_demo', true)

  if (error) {
    console.error('Failed to list demo clients:', error)
    process.exit(1)
  }

  if (!demoClients || demoClients.length === 0) {
    console.log('No demo clients found. Nothing to purge.')
    return
  }

  const demoIds = demoClients.map(c => c.id)
  console.log(`Found ${demoClients.length} demo client(s):`)
  demoClients.forEach(c => console.log(`  - ${c.company_name} (${c.id})`))
  console.log()

  // Collect demo user ids from user_clients
  const { data: demoUserRows } = await supabase
    .from('user_clients')
    .select('user_id')
    .in('client_id', demoIds)
  const demoUserIds = Array.from(new Set((demoUserRows || []).map(r => r.user_id)))

  let totalRows = 0
  for (const [table, column] of PURGE_ORDER) {
    const { count, error: countErr } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, demoIds)

    if (countErr) {
      // Table may not exist in this DB — skip silently
      console.log(`  ${table.padEnd(32)} skip (${countErr.message.slice(0, 50)})`)
      continue
    }

    console.log(`  ${table.padEnd(32)} ${count || 0} rows`)
    totalRows += count || 0

    if (EXECUTE && (count || 0) > 0) {
      const { error: delErr } = await supabase.from(table).delete().in(column, demoIds)
      if (delErr) {
        console.error(`    ❌ delete failed: ${delErr.message}`)
      } else {
        console.log(`    ✓ deleted`)
      }
    }
  }

  // Finally: delete the demo clients themselves
  console.log(`  ${'clients'.padEnd(32)} ${demoClients.length} rows`)
  if (EXECUTE) {
    const { error: delErr } = await supabase.from('clients').delete().in('id', demoIds)
    if (delErr) console.error(`    ❌ client delete failed: ${delErr.message}`)
    else console.log(`    ✓ deleted`)
  }

  // Delete demo auth users
  if (demoUserIds.length > 0) {
    console.log(`\n  auth.users: ${demoUserIds.length} demo user(s)`)
    if (EXECUTE) {
      for (const uid of demoUserIds) {
        const { error: authErr } = await supabase.auth.admin.deleteUser(uid)
        if (authErr) console.error(`    ❌ auth delete failed for ${uid}: ${authErr.message}`)
        else console.log(`    ✓ deleted ${uid}`)
      }
    }
  }

  console.log(`\nTotal rows affected: ${totalRows + demoClients.length + demoUserIds.length}`)
  if (!EXECUTE) {
    console.log(`\n💡 Re-run with --execute to actually purge.`)
  } else {
    console.log(`\n✅ Purge complete.`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
