import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    return null
  }
  return user
}

/**
 * GET /api/admin/channel-mappings
 *
 * Returns all unique (client_id, channel_name) pairs from orders,
 * along with any existing override mapping and ShipBob's default order_type breakdown.
 */
export async function GET() {
  const user = await verifyAdmin()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Get all channels with order counts by ShipBob order_type
  const { data: channels, error: channelsError } = await admin.rpc('get_channel_order_type_summary')

  if (channelsError) {
    // Fallback: query directly if RPC doesn't exist yet
    const { data: rawChannels, error: rawError } = await admin
      .from('orders')
      .select('client_id, channel_name, order_type')
      .not('channel_name', 'is', null)
      .limit(1000)

    if (rawError) {
      return NextResponse.json({ error: rawError.message }, { status: 500 })
    }

    // Won't reach here in practice — we'll create the RPC
    return NextResponse.json({ channels: rawChannels, mappings: [] })
  }

  // Get existing mappings
  const { data: mappings, error: mappingsError } = await admin
    .from('channel_order_type_mappings')
    .select('*')
    .order('client_id')

  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 500 })
  }

  return NextResponse.json({ channels, mappings })
}

/**
 * PUT /api/admin/channel-mappings
 *
 * Upsert channel-to-order-type mappings. Accepts an array of mappings.
 * After saving, queues affected client dates for analytics refresh.
 *
 * Body: { mappings: Array<{ client_id, channel_name, order_type }> }
 */
export async function PUT(request: NextRequest) {
  const user = await verifyAdmin()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { mappings } = body as {
    mappings: Array<{ client_id: string; channel_name: string; order_type: string | null }>
  }

  if (!Array.isArray(mappings)) {
    return NextResponse.json({ error: 'mappings must be an array' }, { status: 400 })
  }

  const admin = createAdminClient()
  const validTypes = ['DTC', 'B2B', 'FBA']
  const affectedClientIds = new Set<string>()

  // Separate into upserts and deletes
  const toUpsert = mappings.filter(m => m.order_type && validTypes.includes(m.order_type))
  const toDelete = mappings.filter(m => !m.order_type) // null = remove override, use ShipBob default

  // Delete removed overrides
  for (const m of toDelete) {
    affectedClientIds.add(m.client_id)
    await admin
      .from('channel_order_type_mappings')
      .delete()
      .eq('client_id', m.client_id)
      .eq('channel_name', m.channel_name)
  }

  // Upsert active overrides
  if (toUpsert.length > 0) {
    for (const m of toUpsert) {
      affectedClientIds.add(m.client_id)
    }

    const { error: upsertError } = await admin
      .from('channel_order_type_mappings')
      .upsert(
        toUpsert.map(m => ({
          client_id: m.client_id,
          channel_name: m.channel_name,
          order_type: m.order_type,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'client_id,channel_name' }
      )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }
  }

  // Queue analytics refresh for affected clients
  // Queue all dates in the last 180 days for each affected client
  if (affectedClientIds.size > 0) {
    const clientIds = Array.from(affectedClientIds)

    // Get the date range that has summaries for these clients
    const { data: dateRanges } = await admin
      .from('analytics_daily_summaries')
      .select('client_id, summary_date')
      .in('client_id', clientIds)
      .gte('summary_date', new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0])
      .order('summary_date')

    if (dateRanges && dateRanges.length > 0) {
      // Get unique (client_id, summary_date) pairs
      const seen = new Set<string>()
      const queueEntries = dateRanges
        .filter((r: { client_id: string; summary_date: string }) => {
          const key = `${r.client_id}:${r.summary_date}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((r: { client_id: string; summary_date: string }) => ({
          client_id: r.client_id,
          summary_date: r.summary_date,
          reason: 'channel_mapping_change',
        }))

      // Insert in batches of 500
      for (let i = 0; i < queueEntries.length; i += 500) {
        const batch = queueEntries.slice(i, i + 500)
        await admin.from('analytics_refresh_queue').insert(batch)
      }

      return NextResponse.json({
        success: true,
        queued: queueEntries.length,
        message: `Saved mappings. Queued ${queueEntries.length} dates for analytics refresh.`,
      })
    }
  }

  return NextResponse.json({ success: true, queued: 0 })
}
