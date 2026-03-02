/**
 * PDF Generation
 *
 * Production: Calls generatePDFInvoice directly. @react-pdf/* is configured as
 * serverExternalPackages in next.config.ts so webpack loads it from node_modules
 * at runtime without bundling conflicts.
 *
 * Development: Uses a subprocess (npx tsx) because Turbopack's module handling
 * causes @react-pdf/renderer's renderToBuffer to hang in-process.
 */
import { spawn } from 'child_process'
import path from 'path'
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
  // Production: direct call works correctly with serverExternalPackages + webpack
  if (process.env.NODE_ENV !== 'development') {
    const { generatePDFInvoice } = await import('./pdf-generator')
    return generatePDFInvoice(data, options)
  }

  // Development: subprocess isolates @react-pdf from Turbopack's module system
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'generate-pdf-worker.ts')

    const child = spawn('npx', ['tsx', scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const input = JSON.stringify({ data, options })
    child.stdin.write(input)
    child.stdin.end()

    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        const pdfBuffer = Buffer.from(Buffer.concat(chunks).toString(), 'base64')
        resolve(pdfBuffer)
      } else {
        reject(new Error(`PDF generation failed (exit code ${code}): ${stderr}`))
      }
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn PDF generator: ${err.message}`))
    })
  })
}
