import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/eshipper-stats
 *
 * Get eShipper shipment statistics for the admin dashboard.
 * Returns total counts, per-client counts, and monthly breakdowns.
 * Admin only.
 */
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get total count
    const { count: totalCount } = await adminClient
      .from('eshipper_shipments')
      .select('id', { count: 'exact', head: true })

    if (!totalCount || totalCount === 0) {
      return NextResponse.json(null)
    }

    // Get date range
    const { data: earliest } = await adminClient
      .from('eshipper_shipments')
      .select('ship_date')
      .order('ship_date', { ascending: true })
      .limit(1)
      .single()

    const { data: latest } = await adminClient
      .from('eshipper_shipments')
      .select('ship_date')
      .order('ship_date', { ascending: false })
      .limit(1)
      .single()

    // Get all clients that have eshipper_id
    const { data: clients } = await adminClient
      .from('clients')
      .select('id, company_name')
      .not('eshipper_id', 'is', null)

    // Get counts per client
    const byClient: Array<{ client_name: string; shipments: number }> = []

    if (clients) {
      for (const client of clients) {
        const { count } = await adminClient
          .from('eshipper_shipments')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)

        if (count && count > 0) {
          byClient.push({
            client_name: client.company_name,
            shipments: count,
          })
        }
      }
    }

    // Also count shipments without client_id (unattributed)
    const { count: unattributedCount } = await adminClient
      .from('eshipper_shipments')
      .select('id', { count: 'exact', head: true })
      .is('client_id', null)

    if (unattributedCount && unattributedCount > 0) {
      byClient.push({
        client_name: 'Unattributed',
        shipments: unattributedCount,
      })
    }

    // Sort by count descending
    byClient.sort((a, b) => b.shipments - a.shipments)

    // Calculate monthly breakdowns for last 3 months
    const now = new Date()
    const months: Array<{
      month: string
      year: number
      monthNum: number
      total: number
      byClient: Array<{ client_name: string; shipments: number }>
    }> = []

    for (let i = 0; i < 3; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const year = date.getFullYear()
      const monthNum = date.getMonth() + 1
      const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`
      const nextMonth = new Date(year, monthNum, 1)
      const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

      const monthName = date.toLocaleString('default', { month: 'short' })

      // Get total for month
      const { count: monthTotal } = await adminClient
        .from('eshipper_shipments')
        .select('id', { count: 'exact', head: true })
        .gte('ship_date', monthStart)
        .lt('ship_date', monthEnd)

      // Get per-client for month
      const monthByClient: Array<{ client_name: string; shipments: number }> = []

      if (clients) {
        for (const client of clients) {
          const { count } = await adminClient
            .from('eshipper_shipments')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .gte('ship_date', monthStart)
            .lt('ship_date', monthEnd)

          if (count && count > 0) {
            monthByClient.push({
              client_name: client.company_name,
              shipments: count,
            })
          }
        }
      }

      monthByClient.sort((a, b) => b.shipments - a.shipments)

      months.push({
        month: monthName,
        year,
        monthNum,
        total: monthTotal || 0,
        byClient: monthByClient,
      })
    }

    return NextResponse.json({
      total_shipments: totalCount,
      date_range: {
        earliest: earliest?.ship_date?.split('T')[0] || '',
        latest: latest?.ship_date?.split('T')[0] || '',
      },
      by_client: byClient,
      by_month: months,
    })
  } catch (error) {
    console.error('Error in eshipper-stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
