/**
 * Email Templates for Invoice Notifications
 *
 * Generates email content when invoices are approved and sent to clients.
 * Uses the simple, professional template specified for invoicing.
 */

export interface InvoiceEmailData {
  invoiceNumber: string      // "JPHS-0038-120825"
  invoiceDate: string         // "2026-02-09" (YYYY-MM-DD format)
  clientName: string          // "Henson Shaving"
}

export interface InvoiceEmailResult {
  subject: string
  text: string
  html: string
}

/**
 * Generate invoice email content
 *
 * Template:
 * - Subject: "Your Jetpack Invoice for [date]"
 * - Simple, professional body as specified
 */
export function generateInvoiceEmail(data: InvoiceEmailData): InvoiceEmailResult {
  // Format date: "February 9, 2026"
  // Parse as UTC noon to avoid timezone shifts
  const date = new Date(data.invoiceDate + 'T12:00:00Z')
  const formattedDate = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const subject = `Your Jetpack Invoice for ${formattedDate}`

  const text = `Hello,

Please find attached your weekly bill for warehousing and fulfillment services.

Feel free to reach out with any questions! We'll keep an eye out for your payment.

Thanks and have a great day!`

  // Convert to HTML (line breaks)
  const html = text.replace(/\n/g, '<br>\n')

  return { subject, text, html }
}
