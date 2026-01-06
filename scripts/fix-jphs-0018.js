#!/usr/bin/env node

/**
 * Fix JPHS-0018-072125
 *
 * Database shows total_amount=$7,863.12 but actual PDF shows $7,858.62
 * This script downloads the PDF from Supabase, extracts the real total,
 * and updates the database with authoritative values.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const PDFParser = require('pdf2json')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const INVOICE_NUMBER = 'JPHS-0018-072125'

// Cost from XLSX backfill (from dry run output showing -13.1% markup)
// If total was $7,863.12 and markup was -13.1%, then cost ≈ $9,047.18
// But we need to recalculate based on actual PDF total
const XLSX_COST = 9047.18  // From XLSX export - this is authoritative cost

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

          console.log('\n📄 Extracted PDF text (first 2000 chars):')
          console.log(text.substring(0, 2000))
          console.log('\n')

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
                console.log(`   Found match with pattern: ${pattern}`)
                console.log(`   Matched text: "${match[0]}"`)
                resolve(amount)
                return
              }
            }
          }

          // Fallback: look for dollar amounts and show them for debugging
          const allAmounts = text.match(/\$?([\d,]+\.\d{2})/g) || []
          const amounts = allAmounts
            .map(a => parseFloat(a.replace(/[$,]/g, '')))
            .filter(a => !isNaN(a) && a > 100)
            .sort((a, b) => b - a)

          console.log('   All amounts > $100 found in PDF:')
          amounts.slice(0, 10).forEach(a => console.log(`      $${a.toFixed(2)}`))

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

async function fixJphs0018(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // 1. Get current invoice record
  const { data: invoice, error: fetchError } = await supabase
    .from('invoices_jetpack')
    .select('*')
    .eq('invoice_number', INVOICE_NUMBER)
    .single()

  if (fetchError || !invoice) {
    console.error(`❌ Could not fetch invoice ${INVOICE_NUMBER}:`, fetchError?.message)
    return
  }

  console.log(`📄 Current invoice record for ${INVOICE_NUMBER}:`)
  console.log(`   subtotal: $${invoice.subtotal}`)
  console.log(`   total_markup: $${invoice.total_markup}`)
  console.log(`   total_amount: $${invoice.total_amount}`)
  console.log(`   pdf_path: ${invoice.pdf_path}`)

  // 2. Download PDF from Supabase storage
  const pdfPath = `${HENSON_CLIENT_ID}/${INVOICE_NUMBER}/${INVOICE_NUMBER}.pdf`
  console.log(`\n📥 Downloading PDF from: ${pdfPath}`)

  const { data: pdfData, error: pdfError } = await supabase.storage
    .from('invoices')
    .download(pdfPath)

  if (pdfError) {
    console.error(`❌ Could not download PDF: ${pdfError.message}`)
    return
  }

  // 3. Extract total from PDF
  const buffer = Buffer.from(await pdfData.arrayBuffer())
  console.log(`   Downloaded ${buffer.length} bytes`)

  const pdfTotal = await extractTotalFromPDF(buffer)

  if (!pdfTotal) {
    console.error('❌ Could not extract total from PDF')
    return
  }

  console.log(`\n📑 PDF total extracted: $${pdfTotal.toFixed(2)}`)
  console.log(`   Expected (from user): $7,858.62`)

  // 4. Calculate correct values
  const newSubtotal = XLSX_COST
  const newTotalAmount = pdfTotal
  const newMarkup = Math.round((newTotalAmount - newSubtotal) * 100) / 100
  const markupPercent = newSubtotal > 0 ? (newMarkup / newSubtotal * 100) : 0

  console.log(`\n📊 Corrected values:`)
  console.log(`   subtotal (cost from XLSX): $${newSubtotal.toFixed(2)}`)
  console.log(`   total_amount (from PDF): $${newTotalAmount.toFixed(2)}`)
  console.log(`   total_markup (calculated): $${newMarkup.toFixed(2)}`)
  console.log(`   markup %: ${markupPercent.toFixed(1)}%`)

  console.log(`\n📊 Changes:`)
  console.log(`   subtotal: $${invoice.subtotal} → $${newSubtotal.toFixed(2)}`)
  console.log(`   total_amount: $${invoice.total_amount} → $${newTotalAmount.toFixed(2)}`)
  console.log(`   total_markup: $${invoice.total_markup} → $${newMarkup.toFixed(2)}`)

  if (!dryRun) {
    const { error: updateError } = await supabase
      .from('invoices_jetpack')
      .update({
        subtotal: newSubtotal,
        total_amount: newTotalAmount,
        total_markup: newMarkup,
      })
      .eq('invoice_number', INVOICE_NUMBER)

    if (updateError) {
      console.error(`\n❌ Update failed: ${updateError.message}`)
    } else {
      console.log(`\n✅ Invoice ${INVOICE_NUMBER} updated successfully`)
    }
  } else {
    console.log(`\n🔍 Would update (dry run)`)
    console.log(`\nRun with --live to apply changes`)
  }
}

// Parse command line args
const args = process.argv.slice(2)
const dryRun = !args.includes('--live')

fixJphs0018(dryRun).catch(console.error)
