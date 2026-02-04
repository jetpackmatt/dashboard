/**
 * eShipper Sync Logic
 *
 * Syncs shipment counts from eShipper API to our database
 * for commission calculations.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getEshipperClient } from './client'

interface SyncResult {
  success: boolean
  clientsProcessed: number
  daysUpdated: number
  errors: string[]
}

/**
 * Sync eShipper shipment counts for all clients that use eShipper
 *
 * @param supabase - Admin Supabase client
 * @param daysBack - How many days back to sync (default: 1 for yesterday)
 */
export async function syncEshipperCounts(
  supabase: SupabaseClient,
  daysBack: number = 1
): Promise<SyncResult> {
  const errors: string[] = []
  let clientsProcessed = 0
  let daysUpdated = 0

  const client = getEshipperClient()
  if (!client) {
    return {
      success: false,
      clientsProcessed: 0,
      daysUpdated: 0,
      errors: ['eShipper API not configured'],
    }
  }

  // Get all clients with eshipper_id set
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, eshipper_id')
    .not('eshipper_id', 'is', null)

  if (clientsError || !clients) {
    return {
      success: false,
      clientsProcessed: 0,
      daysUpdated: 0,
      errors: [`Failed to fetch clients: ${clientsError?.message}`],
    }
  }

  if (clients.length === 0) {
    return {
      success: true,
      clientsProcessed: 0,
      daysUpdated: 0,
      errors: [],
    }
  }

  // Calculate date range
  const today = new Date()
  const dates: Date[] = []
  for (let i = 1; i <= daysBack; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    dates.push(date)
  }

  // Process each client
  for (const clientRow of clients) {
    if (!clientRow.eshipper_id) continue

    try {
      clientsProcessed++

      for (const date of dates) {
        const result = await client.getShipmentCount(clientRow.eshipper_id, date)

        if (!result.success) {
          errors.push(`${clientRow.name}: ${result.error}`)
          continue
        }

        const dateStr = date.toISOString().split('T')[0]

        // Upsert to eshipper_shipment_counts
        const { error: upsertError } = await supabase
          .from('eshipper_shipment_counts')
          .upsert({
            client_id: clientRow.id,
            eshipper_company_id: clientRow.eshipper_id,
            shipment_date: dateStr,
            shipment_count: result.data || 0,
            synced_at: new Date().toISOString(),
          }, {
            onConflict: 'client_id,shipment_date',
          })

        if (upsertError) {
          errors.push(`${clientRow.name} (${dateStr}): ${upsertError.message}`)
        } else {
          daysUpdated++
        }
      }
    } catch (err) {
      errors.push(`${clientRow.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return {
    success: errors.length === 0,
    clientsProcessed,
    daysUpdated,
    errors,
  }
}

/**
 * Sync eShipper counts for a specific client
 */
export async function syncEshipperCountsForClient(
  supabase: SupabaseClient,
  clientId: string,
  daysBack: number = 30
): Promise<SyncResult> {
  const errors: string[] = []
  let daysUpdated = 0

  const client = getEshipperClient()
  if (!client) {
    return {
      success: false,
      clientsProcessed: 0,
      daysUpdated: 0,
      errors: ['eShipper API not configured'],
    }
  }

  // Get client's eshipper_id
  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id, name, eshipper_id')
    .eq('id', clientId)
    .single()

  if (clientError || !clientRow?.eshipper_id) {
    return {
      success: false,
      clientsProcessed: 0,
      daysUpdated: 0,
      errors: ['Client not found or no eshipper_id'],
    }
  }

  // Calculate date range
  const today = new Date()
  const dates: Date[] = []
  for (let i = 0; i < daysBack; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    dates.push(date)
  }

  // Process each date
  for (const date of dates) {
    const result = await client.getShipmentCount(clientRow.eshipper_id, date)

    if (!result.success) {
      errors.push(`${date.toISOString().split('T')[0]}: ${result.error}`)
      continue
    }

    const dateStr = date.toISOString().split('T')[0]

    const { error: upsertError } = await supabase
      .from('eshipper_shipment_counts')
      .upsert({
        client_id: clientRow.id,
        eshipper_company_id: clientRow.eshipper_id,
        shipment_date: dateStr,
        shipment_count: result.data || 0,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'client_id,shipment_date',
      })

    if (upsertError) {
      errors.push(`${dateStr}: ${upsertError.message}`)
    } else {
      daysUpdated++
    }
  }

  return {
    success: errors.length === 0,
    clientsProcessed: 1,
    daysUpdated,
    errors,
  }
}
