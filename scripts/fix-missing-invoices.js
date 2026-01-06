#!/usr/bin/env node

/**
 * Fix Missing Invoices
 *
 * 1. Upload PDF and XLSX files from reference/missing-invoices to Supabase storage
 * 2. Extract total from PDFs
 * 3. Get cost from XLSX backfill data
 * 4. Update invoice records with correct values
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const PDFParser = require('pdf2json')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MISSING_INVOICES_DIR = path.join(__dirname, '../reference/missing-invoices')
const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Invoice configurations - mapping local files to storage paths
const INVOICES_TO_FIX = [
  {
    invoiceNumber: 'JPHS-0016-070725',
    localPdf: 'INVOICE-SUMMARY-JPHS-0016-070725.pdf',
    localXlsx: 'INVOICE-DETAILS-JPHS-0016-070725.xlsx',
    clientId: HENSON_CLIENT_ID,
  },
  {
    invoiceNumber: 'JPHS-0027-092225',
    localPdf: 'INVOICE-SUMMARY-JPHS-0027-092225.pdf',
    localXlsx: 'INVOICE-DETAILS-JPHS-0027-092225.xlsx',
    clientId: HENSON_CLIENT_ID,
  },
]

// Costs from XLSX backfill (already calculated)
const INVOICE_COSTS = {
  'JPHS-0016-070725': 10008.25,  // From backfill output
  'JPHS-0027-092225': 10168.81,  // From backfill output
}

async function extractTotalFromPDF(pdfBuffer) {
  return new Promise((resolve) => {
    try {
      const pdfParser = new PDFParser()

      pdfParser.on('pdfParser_dataError', (errData) => {
        console.error('PDF Parser Error:', errData.parserError)
        resolve(null)
      })

      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        try {
          // Extract text from all pages
          let text = ''
          if (pdfData.Pages) {
            for (const page of pdfData.Pages) {
              if (page.Texts) {
                for (const textItem of page.Texts) {
                  if (textItem.R) {
                    for (const r of textItem.R) {
                      text += decodeURIComponent(r.T) + ' '
                    }
                  }
                }
              }
            }
          }

          // Look for "Total Due" or similar patterns in the PDF
          const patterns = [
            /Total\s+Due[\s:]*\$?([\d,]+\.?\d*)/i,
            /TOTAL[\s:]*\$?([\d,]+\.?\d*)/i,
            /Amount\s+Due[\s:]*\$?([\d,]+\.?\d*)/i,
            /Balance\s+Due[\s:]*\$?([\d,]+\.?\d*)/i,
            /Total\s+Owing[\s:]*\$?([\d,]+\.?\d*)/i,
          ]

          for (const pattern of patterns) {
            const match = text.match(pattern)
            if (match) {
              const amount = parseFloat(match[1].replace(/,/g, ''))
              if (!isNaN(amount) && amount > 0) {
                resolve(amount)
                return
              }
            }
          }

          // Fallback: look for the largest dollar amount
          const allAmounts = text.match(/\$?([\d,]+\.\d{2})/g) || []
          const amounts = allAmounts
            .map(a => parseFloat(a.replace(/[$,]/g, '')))
            .filter(a => !isNaN(a) && a > 100)
            .sort((a, b) => b - a)

          if (amounts.length > 0) {
            resolve(amounts[0])
            return
          }

          resolve(null)
        } catch (error) {
          console.error('Error processing PDF data:', error.message)
          resolve(null)
        }
      })

      pdfParser.parseBuffer(pdfBuffer)
    } catch (error) {
      console.error('Error parsing PDF:', error.message)
      resolve(null)
    }
  })
}

async function uploadFile(localPath, storagePath) {
  const fileBuffer = fs.readFileSync(localPath)

  const { data, error } = await supabase.storage
    .from('invoices')
    .upload(storagePath, fileBuffer, {
      contentType: localPath.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true, // Overwrite if exists
    })

  if (error) {
    throw new Error(`Failed to upload ${storagePath}: ${error.message}`)
  }

  return data
}

async function fixMissingInvoices(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database and storage'}\n`)

  for (const invoice of INVOICES_TO_FIX) {
    console.log(`\n📄 Processing ${invoice.invoiceNumber}...`)

    const localPdfPath = path.join(MISSING_INVOICES_DIR, invoice.localPdf)
    const localXlsxPath = path.join(MISSING_INVOICES_DIR, invoice.localXlsx)

    // Check files exist
    if (!fs.existsSync(localPdfPath)) {
      console.log(`   ❌ PDF not found: ${localPdfPath}`)
      continue
    }
    if (!fs.existsSync(localXlsxPath)) {
      console.log(`   ❌ XLSX not found: ${localXlsxPath}`)
      continue
    }

    console.log(`   ✓ Found local PDF: ${invoice.localPdf}`)
    console.log(`   ✓ Found local XLSX: ${invoice.localXlsx}`)

    // Storage paths
    const storagePdfPath = `${invoice.clientId}/${invoice.invoiceNumber}/${invoice.invoiceNumber}.pdf`
    const storageXlsxPath = `${invoice.clientId}/${invoice.invoiceNumber}/${invoice.invoiceNumber}-details.xlsx`

    // Extract total from PDF
    const pdfBuffer = fs.readFileSync(localPdfPath)
    const pdfTotal = await extractTotalFromPDF(pdfBuffer)

    if (!pdfTotal) {
      console.log(`   ❌ Could not extract total from PDF`)
      continue
    }

    console.log(`   📑 PDF total extracted: $${pdfTotal.toFixed(2)}`)

    // Get cost from our precomputed values
    const cost = INVOICE_COSTS[invoice.invoiceNumber]
    if (!cost) {
      console.log(`   ❌ No cost data found for ${invoice.invoiceNumber}`)
      continue
    }

    console.log(`   💰 Cost from XLSX: $${cost.toFixed(2)}`)

    // Calculate markup
    const markup = Math.round((pdfTotal - cost) * 100) / 100
    const markupPercent = cost > 0 ? (markup / cost * 100) : 0

    console.log(`   📊 Calculated values:`)
    console.log(`      subtotal (cost): $${cost.toFixed(2)}`)
    console.log(`      total_markup (profit): $${markup.toFixed(2)}`)
    console.log(`      total_amount: $${pdfTotal.toFixed(2)}`)
    console.log(`      markup %: ${markupPercent.toFixed(1)}%`)

    if (!dryRun) {
      // Upload files to storage
      console.log(`   📤 Uploading to Supabase storage...`)

      try {
        await uploadFile(localPdfPath, storagePdfPath)
        console.log(`      ✓ Uploaded PDF: ${storagePdfPath}`)

        await uploadFile(localXlsxPath, storageXlsxPath)
        console.log(`      ✓ Uploaded XLSX: ${storageXlsxPath}`)
      } catch (err) {
        console.log(`   ❌ Upload failed: ${err.message}`)
        continue
      }

      // Update invoice record
      const { error: updateError } = await supabase
        .from('invoices_jetpack')
        .update({
          subtotal: cost,
          total_markup: markup,
          total_amount: pdfTotal,
          pdf_path: storagePdfPath,
          xlsx_path: storageXlsxPath,
        })
        .eq('invoice_number', invoice.invoiceNumber)

      if (updateError) {
        console.log(`   ❌ Update failed: ${updateError.message}`)
      } else {
        console.log(`   ✅ Invoice updated successfully`)
      }
    } else {
      console.log(`   🔍 Would upload and update (dry run)`)
    }
  }

  console.log(`\n${dryRun ? 'Run with --live to apply changes' : 'Done!'}\n`)
}

// Parse command line args
const args = process.argv.slice(2)
const dryRun = !args.includes('--live')

fixMissingInvoices(dryRun).catch(console.error)
