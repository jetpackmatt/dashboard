/**
 * PDF Generation
 *
 * Calls generatePDFInvoice directly. @react-pdf/* is configured as
 * serverExternalPackages in next.config.ts so it loads from node_modules
 * at runtime without webpack bundling issues.
 */
import { generatePDFInvoice } from './pdf-generator'
import type { InvoiceData } from './invoice-generator'

export async function generatePDFViaSubprocess(
  data: InvoiceData,
  options?: {
    storagePeriodStart?: string
    storagePeriodEnd?: string
    clientAddress?: {
      street: string
      city: string
      region: string
      postalCode: string
      country: string
    }
    currency?: string
  }
): Promise<Buffer> {
  return generatePDFInvoice(data, options)
}
