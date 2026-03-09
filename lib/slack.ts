/**
 * Slack webhook utility for sending alerts.
 * Uses SLACK_WEBHOOK_URL env var — if not set, silently no-ops.
 */

export function sendSlackAlert(text: string): void {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  // Fire-and-forget — never block the caller
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch((err) => {
    console.error('Slack webhook error:', err)
  })
}
