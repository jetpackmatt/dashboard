#!/usr/bin/env node
/**
 * Delete all ShipBob webhook subscriptions
 *
 * These webhooks are legacy - we now use cron-based sync instead.
 * Run this to stop the 405 errors in Vercel logs.
 *
 * Usage:
 *   node scripts/delete-webhooks.js           # List only (dry run)
 *   node scripts/delete-webhooks.js --delete  # Actually delete
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const token = process.env.SHIPBOB_API_TOKEN

if (!token) {
  console.error('ERROR: SHIPBOB_API_TOKEN not found in .env.local')
  process.exit(1)
}

const shouldDelete = process.argv.includes('--delete')

async function listWebhooks() {
  const webhooks = []
  let cursor = null

  do {
    const url = cursor
      ? `${SHIPBOB_API_BASE}/webhook?Cursor=${encodeURIComponent(cursor)}`
      : `${SHIPBOB_API_BASE}/webhook`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!res.ok) {
      console.error(`API error: ${res.status} ${res.statusText}`)
      const text = await res.text()
      console.error(text)
      process.exit(1)
    }

    const data = await res.json()
    webhooks.push(...(data.items || data || []))
    cursor = data.next || null
  } while (cursor)

  return webhooks
}

async function deleteWebhook(id) {
  const res = await fetch(`${SHIPBOB_API_BASE}/webhook/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok && res.status !== 204) {
    console.error(`  Failed to delete ${id}: ${res.status}`)
    return false
  }
  return true
}

async function main() {
  console.log('Fetching webhook subscriptions from ShipBob...\n')

  const webhooks = await listWebhooks()

  if (webhooks.length === 0) {
    console.log('✅ No webhook subscriptions found. Nothing to delete.')
    return
  }

  console.log(`Found ${webhooks.length} webhook subscription(s):\n`)
  console.log('─'.repeat(80))

  for (const wh of webhooks) {
    console.log(`ID:    ${wh.id}`)
    console.log(`Topic: ${wh.topic}`)
    console.log(`URL:   ${wh.subscription_url}`)
    console.log('─'.repeat(80))
  }

  if (!shouldDelete) {
    console.log('\n⚠️  DRY RUN - No webhooks deleted.')
    console.log('Run with --delete flag to actually delete them:')
    console.log('  node scripts/delete-webhooks.js --delete\n')
    return
  }

  console.log('\nDeleting webhooks...\n')

  let deleted = 0
  let failed = 0

  for (const wh of webhooks) {
    process.stdout.write(`Deleting ${wh.id} (${wh.topic})... `)
    const success = await deleteWebhook(wh.id)
    if (success) {
      console.log('✅')
      deleted++
    } else {
      console.log('❌')
      failed++
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}`)

  if (deleted > 0) {
    console.log('\n✅ Webhook subscriptions removed. The 405 errors should stop shortly.')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
