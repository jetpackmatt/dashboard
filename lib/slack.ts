/**
 * Slack webhook utilities for sending alerts.
 *
 * Slack incoming webhooks are per-channel (the channel is baked into the URL
 * when the webhook is created), so routing to a specific channel requires a
 * separate webhook URL per channel. Each channel maps to its own env var:
 *
 *   SLACK_WEBHOOK_URL              → default/general channel
 *   SLACK_WEBHOOK_SUPPORT_ALERTS   → #support-alerts
 *
 * If the relevant env var isn't set, the call silently no-ops so dev/CI
 * environments don't spam a prod channel.
 */

type SlackChannel = 'default' | 'support-alerts'

const CHANNEL_ENV: Record<SlackChannel, string> = {
  'default': 'SLACK_WEBHOOK_URL',
  'support-alerts': 'SLACK_WEBHOOK_SUPPORT_ALERTS',
}

export function sendSlackAlert(text: string, channel: SlackChannel = 'default'): void {
  const envVar = CHANNEL_ENV[channel]
  const webhookUrl = process.env[envVar]
  if (!webhookUrl) {
    console.warn(`[Slack] ${envVar} not set — skipping ${channel} alert: ${text.slice(0, 120)}`)
    return
  }

  // Fire-and-forget — never block the caller
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch((err) => {
    console.error('[Slack] Webhook error:', err)
  })
}
