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

// ============================================================================
// Invoice Email Functions
// ============================================================================

export interface SendInvoiceEmailOptions {
  to: string[]
  bcc?: string[]
  subject: string
  html: string
  text: string
  attachments: Array<{
    filename: string
    content: Buffer
  }>
}

/**
 * Send invoice email via Resend
 *
 * In test mode (EMAIL_TEST_MODE=true): sends only to matt@shipwithjetpack.com
 * In production (EMAIL_TEST_MODE=false): sends to specified recipients + BCC
 */
export async function sendInvoiceEmail(options: SendInvoiceEmailOptions) {
  // Test mode override
  const recipients = IS_TEST_MODE
    ? ['matt@shipwithjetpack.com']
    : options.to

  const bccRecipients = IS_TEST_MODE
    ? undefined
    : ['billing@shipwithjetpack.com', 'matt@shipwithjetpack.com']

  console.log(`[Invoice Email] Sending to ${recipients.join(', ')} - Test mode: ${IS_TEST_MODE}`)

  try {
    const result = await resend.emails.send({
      from: 'Jetpack Billing <billing@shipwithjetpack.com>',
      to: recipients,
      bcc: bccRecipients,
      replyTo: 'billing@shipwithjetpack.com',
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    })

    if (result.error) {
      console.error('[Invoice Email] Resend error:', result.error)
      throw new Error(result.error.message)
    }

    console.log(`[Invoice Email] Email sent successfully. ID: ${result.data?.id}`)
    return result.data
  } catch (error) {
    console.error('[Invoice Email] Failed to send email:', error)
    throw error
  }
}

/**
 * Fetch invoice files from Storage with CRITICAL security validation
 *
 * SECURITY: Paths MUST start with {client_id}/ to prevent data leakage
 * This is a zero-tolerance security requirement - wrong client data CANNOT be sent
 */
export async function fetchInvoiceFiles(
  clientId: string,
  pdfPath: string,
  xlsxPath: string
): Promise<{ pdfBuffer: Buffer; xlsxBuffer: Buffer }> {
  const supabase = createAdminClient()

  // CRITICAL: Validate file paths match client_id
  if (!pdfPath.startsWith(`${clientId}/`)) {
    throw new Error(`Security violation: PDF path does not match client ${clientId}`)
  }
  if (!xlsxPath.startsWith(`${clientId}/`)) {
    throw new Error(`Security violation: XLSX path does not match client ${clientId}`)
  }

  // Generate signed URLs (1 hour expiry, sufficient for email send)
  const [pdfResult, xlsxResult] = await Promise.all([
    supabase.storage.from('invoices').createSignedUrl(pdfPath, 3600),
    supabase.storage.from('invoices').createSignedUrl(xlsxPath, 3600),
  ])

  if (pdfResult.error) {
    throw new Error(`Failed to get PDF URL: ${pdfResult.error.message}`)
  }
  if (xlsxResult.error) {
    throw new Error(`Failed to get XLSX URL: ${xlsxResult.error.message}`)
  }

  // Fetch files as buffers
  const [pdfBuffer, xlsxBuffer] = await Promise.all([
    fetchAttachmentBuffer(pdfResult.data.signedUrl, 'invoice.pdf'),
    fetchAttachmentBuffer(xlsxResult.data.signedUrl, 'invoice.xlsx'),
  ])

  return {
    pdfBuffer: pdfBuffer.content,
    xlsxBuffer: xlsxBuffer.content,
  }
}
