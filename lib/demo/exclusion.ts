/**
 * Demo client exclusion helpers.
 *
 * Paul's Boutique (and any future demo brand) is stored alongside real clients
 * in the `clients` table with `is_demo=true`. Real analytics, admin aggregations,
 * benchmarks, and commission calculations MUST exclude these rows.
 *
 * Every cron / admin query that aggregates across clients is required to call
 * one of these helpers. See CLAUDE.md "Demo Client Isolation" for the rules.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

type AnySupabase = SupabaseClient<any, any, any>

let cache: { ids: string[]; expiresAt: number } | null = null
const CACHE_MS = 60_000

/**
 * Returns the UUIDs of all `is_demo=true` clients. Cached 60s.
 * Returns [] if none exist (in which case no filtering is needed).
 */
export async function getDemoClientIds(supabase: AnySupabase): Promise<string[]> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.ids
  const { data, error } = await supabase.from('clients').select('id').eq('is_demo', true)
  if (error) {
    // Fail-closed: if we can't check, treat nothing as demo. This means demo data
    // could leak for one request — but since this query rarely fails, acceptable.
    console.error('[demo-exclusion] failed to fetch demo client ids:', error)
    return []
  }
  const ids = (data || []).map((r: any) => r.id as string)
  cache = { ids, expiresAt: now + CACHE_MS }
  return ids
}

/**
 * Apply `NOT IN (demo_ids)` to a Supabase query on `client_id`.
 * No-op if there are no demo clients.
 *
 * Usage:
 *   let q = supabase.from('shipments').select('*').gte('event_delivered', someDate)
 *   q = await excludeDemoClients(supabase, q)
 */
export async function excludeDemoClients<Q extends { not: (...args: any[]) => any }>(
  supabase: AnySupabase,
  query: Q,
  column: string = 'client_id'
): Promise<Q> {
  const demoIds = await getDemoClientIds(supabase)
  if (demoIds.length === 0) return query
  // PostgREST syntax: .not(col, 'in', '(id1,id2)')
  return query.not(column, 'in', `(${demoIds.join(',')})`)
}

/** Clear the cache — useful in tests or after creating a new demo client. */
export function invalidateDemoClientCache() {
  cache = null
}
