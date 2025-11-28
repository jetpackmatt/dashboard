/**
 * Register ShipBob Webhooks for Clients
 *
 * Creates webhook subscriptions for each client using their PAT token.
 * All webhooks point to our single endpoint that handles all clients.
 *
 * Usage:
 *   node scripts/register-webhooks.js --url https://your-domain.com
 *   node scripts/register-webhooks.js --url https://your-domain.com --client henson
 *   node scripts/register-webhooks.js --list  # List existing webhooks
 *   node scripts/register-webhooks.js --delete --client henson  # Delete webhooks for a client
 *
 * ShipBob 2025-07 API: POST /2025-07/webhook
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_BASE = 'https://api.shipbob.com'

// All available webhook topics (2025-07 API)
const ALL_TOPICS = [
  // Order/Shipment topics
  'order.shipped',
  'order.shipment.delivered',
  'order.shipment.exception',
  'order.shipment.on_hold',
  'order.shipment.cancelled',
  // Return topics
  'return.created',
  'return.updated',
  'return.completed',
]

// Client name mappings for convenience
const CLIENT_ALIASES = {
  'henson': '6b94c274-0446-4167-9d02-b998f8be59ad',
  'methyl-life': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
}

/**
 * Get client ID from alias or UUID
 */
function resolveClientId(clientArg) {
  if (!clientArg) return null
  return CLIENT_ALIASES[clientArg.toLowerCase()] || clientArg
}

/**
 * Get all clients with their API tokens
 */
async function getClientsWithTokens(specificClientId = null) {
  let query = supabase
    .from('clients')
    .select(`
      id,
      company_name,
      client_api_credentials (
        api_token,
        provider
      )
    `)
    .eq('is_active', true)

  if (specificClientId) {
    query = query.eq('id', specificClientId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch clients:', error)
    return []
  }

  // Filter to clients with ShipBob tokens
  return (data || [])
    .filter(client => {
      const shipbobCred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
      return shipbobCred?.api_token
    })
    .map(client => ({
      id: client.id,
      name: client.company_name,
      token: client.client_api_credentials.find(c => c.provider === 'shipbob').api_token,
    }))
}

/**
 * Get existing webhook subscriptions for a client
 */
async function getWebhooks(token) {
  const response = await fetch(`${SHIPBOB_API_BASE}/2025-07/webhook`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to get webhooks: ${response.status} - ${text}`)
  }

  const data = await response.json()
  return data.items || []
}

/**
 * Create a webhook subscription for a client
 */
async function createWebhook(token, webhookUrl, topics, description = null) {
  const body = {
    url: webhookUrl,
    topics: topics,
  }

  if (description) {
    body.description = description
  }

  const response = await fetch(`${SHIPBOB_API_BASE}/2025-07/webhook`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create webhook: ${response.status} - ${text}`)
  }

  return response.json()
}

/**
 * Delete a webhook subscription
 */
async function deleteWebhook(token, webhookId) {
  const response = await fetch(`${SHIPBOB_API_BASE}/2025-07/webhook/${webhookId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })

  if (!response.ok && response.status !== 204) {
    const text = await response.text()
    throw new Error(`Failed to delete webhook: ${response.status} - ${text}`)
  }

  return true
}

/**
 * List webhooks for all clients
 */
async function listWebhooks(specificClientId = null) {
  const clients = await getClientsWithTokens(specificClientId)

  if (clients.length === 0) {
    console.log('No clients found with ShipBob API tokens.')
    return
  }

  console.log(`\n=== Listing Webhooks for ${clients.length} Client(s) ===\n`)

  for (const client of clients) {
    console.log(`\n📦 ${client.name} (${client.id})`)
    console.log('─'.repeat(50))

    try {
      const webhooks = await getWebhooks(client.token)

      if (!webhooks || webhooks.length === 0) {
        console.log('  No webhooks registered.')
      } else {
        for (const wh of webhooks) {
          console.log(`  ID: ${wh.id}`)
          console.log(`  URL: ${wh.url}`)
          console.log(`  Topics: ${wh.topics?.join(', ') || 'N/A'}`)
          console.log(`  Created: ${wh.created_at}`)
          console.log('')
        }
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`)
    }
  }
}

/**
 * Register webhooks for clients
 */
async function registerWebhooks(baseUrl, specificClientId = null) {
  const webhookUrl = `${baseUrl}/api/webhooks/shipbob`
  const clients = await getClientsWithTokens(specificClientId)

  if (clients.length === 0) {
    console.log('No clients found with ShipBob API tokens.')
    return
  }

  console.log(`\n=== Registering Webhooks for ${clients.length} Client(s) ===`)
  console.log(`Webhook URL: ${webhookUrl}`)
  console.log(`Topics: ${ALL_TOPICS.length} (${ALL_TOPICS.join(', ')})\n`)

  for (const client of clients) {
    console.log(`\n📦 ${client.name}`)
    console.log('─'.repeat(50))

    try {
      // Check existing webhooks
      const existing = await getWebhooks(client.token)
      const existingForUrl = existing?.filter(wh => wh.url === webhookUrl) || []

      if (existingForUrl.length > 0) {
        console.log(`  ⚠️  Already has webhook(s) for this URL:`)
        for (const wh of existingForUrl) {
          console.log(`     ID: ${wh.id}, Topics: ${wh.topics?.join(', ')}`)
        }
        console.log(`  Skipping... (use --delete first to recreate)`)
        continue
      }

      // Create new webhook subscription
      const result = await createWebhook(
        client.token,
        webhookUrl,
        ALL_TOPICS,
        `Jetpack Dashboard - ${client.name}`
      )

      console.log(`  ✅ Created webhook subscription`)
      console.log(`     ID: ${result.id}`)
      console.log(`     Topics: ${result.topics?.join(', ')}`)
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`)
    }
  }

  console.log('\n✅ Done!')
}

/**
 * Delete webhooks for clients
 */
async function deleteWebhooks(specificClientId = null, webhookUrl = null) {
  const clients = await getClientsWithTokens(specificClientId)

  if (clients.length === 0) {
    console.log('No clients found with ShipBob API tokens.')
    return
  }

  console.log(`\n=== Deleting Webhooks for ${clients.length} Client(s) ===\n`)

  for (const client of clients) {
    console.log(`\n📦 ${client.name}`)
    console.log('─'.repeat(50))

    try {
      const webhooks = await getWebhooks(client.token)

      if (!webhooks || webhooks.length === 0) {
        console.log('  No webhooks to delete.')
        continue
      }

      // Filter to specific URL if provided
      const toDelete = webhookUrl
        ? webhooks.filter(wh => wh.url === webhookUrl)
        : webhooks

      if (toDelete.length === 0) {
        console.log(`  No webhooks matching URL: ${webhookUrl}`)
        continue
      }

      for (const wh of toDelete) {
        await deleteWebhook(client.token, wh.id)
        console.log(`  🗑️  Deleted webhook ${wh.id} (${wh.url})`)
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`)
    }
  }

  console.log('\n✅ Done!')
}

// Parse command line arguments
const args = process.argv.slice(2)
const getArg = (name) => {
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1] || true
}

const hasFlag = (name) => args.includes(name)

async function main() {
  const baseUrl = getArg('--url')
  const clientArg = getArg('--client')
  const clientId = resolveClientId(clientArg)

  if (hasFlag('--list')) {
    await listWebhooks(clientId)
  } else if (hasFlag('--delete')) {
    const urlToDelete = getArg('--delete-url')
    await deleteWebhooks(clientId, urlToDelete)
  } else if (baseUrl) {
    await registerWebhooks(baseUrl, clientId)
  } else {
    console.log(`
ShipBob Webhook Registration Script

Usage:
  node scripts/register-webhooks.js --url <base-url>     Register webhooks for all clients
  node scripts/register-webhooks.js --url <url> --client henson   Register for specific client
  node scripts/register-webhooks.js --list               List existing webhooks
  node scripts/register-webhooks.js --list --client henson        List for specific client
  node scripts/register-webhooks.js --delete             Delete all webhooks
  node scripts/register-webhooks.js --delete --client henson      Delete for specific client
  node scripts/register-webhooks.js --delete --delete-url <url>   Delete webhooks matching URL

Options:
  --url <base-url>     Base URL of your deployed app (e.g., https://dashboard.jetpack.com)
  --client <name|id>   Specific client (name alias or UUID)
  --list               List existing webhooks
  --delete             Delete webhooks
  --delete-url <url>   Only delete webhooks matching this URL

Client Aliases:
  henson       → ${CLIENT_ALIASES['henson']}
  methyl-life  → ${CLIENT_ALIASES['methyl-life']}

Webhook Topics (2025-07 API):
  ${ALL_TOPICS.join('\n  ')}
    `)
  }
}

main().catch(console.error)
