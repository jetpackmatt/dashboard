/**
 * Slack webhook utility for sending alerts.
 *
 * Uses the single SLACK_WEBHOOK_URL already configured in Vercel. Callers can
 * optionally pass a `channel` override (e.g. '#support-alerts') which Slack's
 * classic incoming webhooks honor via the payload — modern workspace webhooks
 * silently fall back to the default channel the webhook was created for, so
 * either way the alert reaches Slack.
 *
 * If SLACK_WEBHOOK_URL isn't set, the call silently no-ops so dev/CI
 * environments don't spam a prod channel.
 */

interface SlackOptions {
  /** Channel override, e.g. '#support-alerts'. Honored by classic webhooks. */
  channel?: string
  /**
   * Webhook URL override. Use this for channels the default webhook's bot
   * can't reach (e.g. private channels). Modern workspace webhooks silently
   * ignore the channel override and post to their configured default, so
   * private/restricted channels need their own dedicated webhook URL stored
   * in a separate env var.
   */
  webhookUrl?: string
}

export function sendSlackAlert(text: string, opts: SlackOptions = {}): void {
  const webhookUrl = opts.webhookUrl || process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    console.warn(`[Slack] No webhook URL — skipping alert: ${text.slice(0, 120)}`)
    return
  }

  const payload: Record<string, unknown> = { text }
  if (opts.channel) payload.channel = opts.channel

  // Fire-and-forget — never block the caller
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error('[Slack] Webhook error:', err)
  })
}
