import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Client size labels based on monthly shipment volume
 * These are internal classifications using ocean creature metaphors
 */
const SIZE_THRESHOLDS = [
  { label: 'whale', min: 50000 },      // > 50,000
  { label: 'shark', min: 10000 },      // 10,000 - 50,000
  { label: 'swordfish', min: 5000 },   // 5,000 - 10,000
  { label: 'dolphin', min: 1000 },     // 1,000 - 5,000
  { label: 'musky', min: 500 },        // 500 - 1,000
  { label: 'bass', min: 100 },         // 100 - 500
  { label: 'goldfish', min: 0 },       // < 100
]

function getSizeLabel(shipmentCount: number): string {
  for (const threshold of SIZE_THRESHOLDS) {
    if (shipmentCount >= threshold.min) {
      return threshold.label
    }
  }
  return 'goldfish'
}

/**
 * GET /api/cron/calculate-client-sizes
 *
 * Recalculates size labels for all active clients based on
 * the previous full calendar month's shipment volumes.
 *
 * Scheduled: 1st of each month at 6 AM UTC
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const supabase = createAdminClient()

    // Calculate the previous full calendar month
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0) // Last day of previous month

    const periodStart = lastMonth.toISOString().split('T')[0]
    const periodEnd = lastMonthEnd.toISOString().split('T')[0]

    console.log(`Calculating client sizes for period: ${periodStart} to ${periodEnd}`)

    // Get all active clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, company_name, merchant_id, eshipper_id')
      .eq('is_active', true)

    if (clientsError) {
      console.error('Error fetching clients:', clientsError)
      return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 })
    }

    const results: Array<{
      client_name: string
      shipments: number
      old_label: string | null
      new_label: string
    }> = []

    for (const client of clients || []) {
      let totalShipments = 0

      // Count ShipBob shipments (if client has merchant_id)
      if (client.merchant_id) {
        const { count, error } = await supabase
          .from('shipments')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('created_at', periodStart)
          .lte('created_at', periodEnd + 'T23:59:59.999Z')

        if (!error && count !== null) {
          totalShipments += count
        }
      }

      // Count eShipper shipments (if client has eshipper_id)
      if (client.eshipper_id) {
        const { count, error } = await supabase
          .from('eshipper_shipments')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('ship_date', periodStart)
          .lte('ship_date', periodEnd)

        if (!error && count !== null) {
          totalShipments += count
        }
      }

      // Determine new size label
      const newLabel = getSizeLabel(totalShipments)

      // Get current label for comparison
      const { data: currentClient } = await supabase
        .from('clients')
        .select('size_label')
        .eq('id', client.id)
        .single()

      const oldLabel = currentClient?.size_label || null

      // Update the client's size_label
      const { error: updateError } = await supabase
        .from('clients')
        .update({ size_label: newLabel })
        .eq('id', client.id)

      if (updateError) {
        console.error(`Error updating size label for ${client.company_name}:`, updateError)
      } else {
        results.push({
          client_name: client.company_name,
          shipments: totalShipments,
          old_label: oldLabel,
          new_label: newLabel,
        })

        if (oldLabel !== newLabel) {
          console.log(`${client.company_name}: ${oldLabel || 'none'} → ${newLabel} (${totalShipments} shipments)`)
        }
      }
    }

    // Sort by shipments descending for readability
    results.sort((a, b) => b.shipments - a.shipments)

    console.log(`Updated size labels for ${results.length} clients`)

    return NextResponse.json({
      success: true,
      period: { start: periodStart, end: periodEnd },
      updated: results.length,
      results,
    })
  } catch (error) {
    console.error('Error in calculate-client-sizes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
