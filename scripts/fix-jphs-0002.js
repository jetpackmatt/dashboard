#!/usr/bin/env node

/**
 * Fix JPHS-0002-033125
 * Upload missing PDF to Supabase and update total_amount from PDF
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

const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const INVOICE_NUMBER = 'JPHS-0002-033125'
const LOCAL_PDF = path.join(__dirname, '../reference/missing-invoices/INVOICE-SUMMARY-JPHS-0002-033125.pdf')

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

          // Look for patterns
          const patterns = [
            /Total\s+Due[\s:]*\$?([\d,]+\.?\d*)/i,
            /TOTAL[\s:]*\$?([\d,]+\.?\d*)/i,
            /Amount\s+Due[\s:]*\$?([\d,]+\.?\d*)/i,
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

          // Fallback: largest dollar amount
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
          resolve(null)
        }
      })

      pdfParser.parseBuffer(pdfBuffer)
    } catch (error) {
      resolve(null)
    }
  })
}

async function fixJphs0002(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // Check local PDF exists
  if (!fs.existsSync(LOCAL_PDF)) {
    console.error(`❌ PDF not found: ${LOCAL_PDF}`)
    return
  }
  console.log(`✓ Found local PDF: ${LOCAL_PDF}`)

  // Get current invoice record
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices_jetpack')
    .select('*')
    .eq('invoice_number', INVOICE_NUMBER)
    .single()

  if (fetchError || !invoice) {
    console.error(`❌ Could not fetch invoice ${INVOICE_NUMBER}:`, fetchError?.message)
    return
  }

  console.log(`\n📄 Current invoice record:`)
  console.log(`   subtotal: $${invoice.subtotal}`)
  console.log(`   total_markup: $${invoice.total_markup}`)
  console.log(`   total_amount: $${invoice.total_amount}`)

  // Extract total from PDF
  const pdfBuffer = fs.readFileSync(LOCAL_PDF)
  const pdfTotal = await extractTotalFromPDF(pdfBuffer)

  if (!pdfTotal) {
    console.error('❌ Could not extract total from PDF')
    return
  }

  console.log(`\n📑 PDF total extracted: $${pdfTotal.toFixed(2)}`)

  // Calculate new markup
  const dbSubtotal = parseFloat(invoice.subtotal) || 0
  const newMarkup = Math.round((pdfTotal - dbSubtotal) * 100) / 100
  const markupPercent = dbSubtotal > 0 ? (newMarkup / dbSubtotal * 100) : 0

  console.log(`\n📊 Corrected values:`)
  console.log(`   subtotal (unchanged): $${dbSubtotal.toFixed(2)}`)
  console.log(`   total_amount (from PDF): $${pdfTotal.toFixed(2)}`)
  console.log(`   total_markup (calculated): $${newMarkup.toFixed(2)}`)
  console.log(`   markup %: ${markupPercent.toFixed(1)}%`)

  const storagePath = `${HENSON_CLIENT_ID}/${INVOICE_NUMBER}/${INVOICE_NUMBER}.pdf`

  if (!dryRun) {
    // Upload PDF to Supabase storage
    console.log(`\n📤 Uploading PDF to: ${storagePath}`)

    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error(`❌ Upload failed: ${uploadError.message}`)
      return
    }
    console.log(`   ✅ PDF uploaded`)

    // Update invoice record
    const { error: updateError } = await supabase
      .from('invoices_jetpack')
      .update({
        total_amount: pdfTotal,
        total_markup: newMarkup,
        pdf_path: storagePath,
      })
      .eq('invoice_number', INVOICE_NUMBER)

    if (updateError) {
      console.error(`❌ Update failed: ${updateError.message}`)
    } else {
      console.log(`   ✅ Invoice ${INVOICE_NUMBER} updated successfully`)
    }
  } else {
    console.log(`\n🔍 Would upload PDF and update (dry run)`)
    console.log(`\nRun with --live to apply changes`)
  }
}

const args = process.argv.slice(2)
const dryRun = !args.includes('--live')

fixJphs0002(dryRun).catch(console.error)
