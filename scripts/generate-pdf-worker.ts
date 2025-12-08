/**
 * PDF Generation Worker
 *
 * Reads InvoiceData from stdin (JSON), generates PDF, outputs base64 to stdout.
 * Used as subprocess to avoid Next.js webpack bundling issues.
 */
import { generatePDFInvoice } from '../lib/billing/pdf-generator'

async function main() {
  // Read all stdin
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString()

  try {
    const { data, options } = JSON.parse(input)
    const pdfBuffer = await generatePDFInvoice(data, options)

    // Output as base64 to stdout
    process.stdout.write(pdfBuffer.toString('base64'))
    process.exit(0)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Error: ${message}\n`)
    process.exit(1)
  }
}

main()
