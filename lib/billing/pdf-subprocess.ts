/**
 * PDF Generation via Subprocess
 *
 * Workaround for Next.js/webpack bundling issues with @react-pdf/renderer.
 * Generates PDF by spawning a separate Node.js process.
 */
import { spawn } from 'child_process'
import path from 'path'
import type { InvoiceData } from './invoice-generator'

/**
 * Generate PDF invoice using subprocess to avoid webpack bundling issues
 */
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
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'generate-pdf-worker.ts')

    // Spawn tsx to run the worker script
    const child = spawn('npx', ['tsx', scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Send data to stdin
    const input = JSON.stringify({ data, options })
    child.stdin.write(input)
    child.stdin.end()

    // Collect stdout as buffer chunks
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // Collect stderr for errors
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        const output = Buffer.concat(chunks)
        // The output is base64-encoded PDF
        const pdfBuffer = Buffer.from(output.toString(), 'base64')
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
