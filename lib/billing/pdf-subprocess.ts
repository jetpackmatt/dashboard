/**
 * PDF Generation via isolated subprocess.
 *
 * `@react-pdf/renderer` + Next.js bundler don't agree on a single React instance,
 * which causes "Minified React error #31" / "older version of React" in production.
 * We sidestep this by spawning a pre-bundled standalone CJS worker (pdf-worker.cjs)
 * via `node` in a fresh process — it loads its own @react-pdf + React from node_modules
 * and never touches Next's bundled React.
 *
 * The worker is built by `scripts/build-pdf-worker.mjs` (runs in `prebuild`) and
 * emitted at the repo root so `process.cwd()` on Vercel resolves it correctly.
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
  return new Promise((resolve, reject) => {
    const workerPath = path.join(process.cwd(), 'pdf-worker.cjs')

    const child = spawn(process.execPath, [workerPath], {
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
