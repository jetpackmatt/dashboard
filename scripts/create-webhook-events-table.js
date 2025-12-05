/**
 * Migration: Create webhook_events table
 *
 * Run this script to create the table for logging ShipBob webhook events:
 *   node scripts/create-webhook-events-table.js
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function createWebhookEventsTable() {
  console.log('Creating webhook_events table...')

  // Create table using raw SQL via RPC
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider TEXT NOT NULL,
        topic TEXT NOT NULL,
        webhook_id TEXT,
        payload JSONB,
        received_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_topic ON webhook_events(topic);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
    `
  })

  if (error) {
    // RPC might not exist, try alternative approach
    console.log('RPC not available, table may need manual creation.')
    console.log('\nRun this SQL in Supabase Dashboard:')
    console.log(`
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  topic TEXT NOT NULL,
  webhook_id TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_events_topic ON webhook_events(topic);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
    `)
    return
  }

  console.log('Table created successfully!')
}

// Test insert to verify table works
async function testTable() {
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      provider: 'test',
      topic: 'test.event',
      webhook_id: 'test-123',
      payload: { test: true },
    })
    .select()

  if (error) {
    console.log('Table test failed:', error.message)
    console.log('\nTable may not exist. Please run the SQL above in Supabase Dashboard.')
  } else {
    console.log('Table works! Test row:', data)
    // Clean up test row
    await supabase.from('webhook_events').delete().eq('id', data[0].id)
    console.log('Test row cleaned up.')
  }
}

createWebhookEventsTable().then(testTable)
