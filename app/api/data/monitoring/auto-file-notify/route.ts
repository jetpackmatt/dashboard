import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { sendSlackAlert } from '@/lib/slack'

/**
 * POST /api/data/monitoring/auto-file-notify
 *
 * Sends a Slack alert summarizing an auto-file batch.
 * Called once after the client-side batch loop completes.
 *
 * Body: { clientId, filed, skipped, total }
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { clientId, filed, skipped, total } = body

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  try {
    await verifyClientAccess(clientId)
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const { data: client } = await supabase
    .from('clients')
    .select('company_name')
    .eq('id', clientId)
    .single()

  const brandName = client?.company_name || 'Unknown Brand'

  sendSlackAlert(
    `📋 *Auto-File Enabled* — ${brandName}\n` +
    `Filed ${filed} of ${total} eligible claim${total === 1 ? '' : 's'}` +
    (skipped > 0 ? ` (${skipped} skipped — no longer eligible)` : '') +
    `\nNew claims will be auto-filed daily at 4 AM EST.`
  )

  return NextResponse.json({ success: true })
}
