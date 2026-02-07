import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

const resend = new Resend(process.env.RESEND_API_KEY)
const IS_TEST_MODE = process.env.EMAIL_TEST_MODE !== 'false'

export interface SendClaimEmailOptions {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  text: string
  attachments?: Array<{
    filename: string
    content: Buffer
  }>
}

/**
 * Send a claim notification email via Resend
 *
 * In test mode (EMAIL_TEST_MODE=true, the default), emails are only sent to matt@shipwithjetpack.com
 * In production mode (EMAIL_TEST_MODE=false), emails go to the specified recipients
 */
export async function sendClaimEmail(options: SendClaimEmailOptions) {
  // In test mode, override recipients to only send to Matt
  const recipients = IS_TEST_MODE
    ? ['matt@shipwithjetpack.com']
    : options.to

  const ccRecipients = IS_TEST_MODE
    ? undefined
    : options.cc

  console.log(`[Email] Sending claim email to ${recipients.join(', ')}${ccRecipients ? ` (CC: ${ccRecipients.join(', ')})` : ''} - Test mode: ${IS_TEST_MODE}`)

  try {
    const result = await resend.emails.send({
      from: 'Jetpack Care <support@shipwithjetpack.com>',
      to: recipients,
      cc: ccRecipients,
      replyTo: 'support@shipwithjetpack.com',
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    })

    if (result.error) {
      console.error('[Email] Resend error:', result.error)
      throw new Error(result.error.message)
    }

    console.log(`[Email] Email sent successfully. ID: ${result.data?.id}`)
    return result.data
  } catch (error) {
    console.error('[Email] Failed to send email:', error)
    throw error
  }
}

/**
 * Fetch attachment from a signed URL and convert to buffer for email attachment
 */
export async function fetchAttachmentBuffer(url: string, filename: string): Promise<{ filename: string; content: Buffer }> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return {
    filename,
    content: Buffer.from(arrayBuffer),
  }
}

/**
 * Fetch multiple attachments from Supabase Storage
 *
 * Generates fresh signed URLs from stored paths (since signed URLs expire).
 * Falls back to stored URL if path is not available.
 */
export async function fetchAttachmentBuffers(
  attachments: Array<{ url: string; name: string; path?: string }>
): Promise<Array<{ filename: string; content: Buffer }>> {
  const supabase = createAdminClient()

  const results = await Promise.all(
    attachments.map(async (att) => {
      let fetchUrl = att.url

      // If we have a path, generate a fresh signed URL (private bucket)
      if (att.path) {
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from('claim-attachments')
          .createSignedUrl(att.path, 300) // 5 min expiry - just enough to fetch

        if (!signedUrlError && signedUrlData?.signedUrl) {
          fetchUrl = signedUrlData.signedUrl
        } else {
          console.warn(`[Email] Failed to create signed URL for ${att.path}, using stored URL`)
        }
      }

      return fetchAttachmentBuffer(fetchUrl, att.name)
    })
  )
  return results
}
