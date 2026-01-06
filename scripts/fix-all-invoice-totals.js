#!/usr/bin/env node

/**
 * Fix All Invoice Totals from PDFs
 *
 * Downloads every invoice PDF from Supabase storage and updates
 * the database total_amount field to match the authoritative PDF value.
 * Recalculates total_markup = total_amount - subtotal
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const PDFParser = require('pdf2json')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function extractTotalFromPDF(pdfBuffer) {
  return new Promise((resolve) => {
    try {
      const pdfParser = new PDFParser()

      pdfParser.on('pdfParser_dataError', (errData) => {
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

async function fixAllInvoiceTotals(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // Get all invoices with PDF paths
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, subtotal, total_markup, total_amount, pdf_path')
    .not('pdf_path', 'is', null)
    .in('status', ['approved', 'sent'])
    .order('invoice_number', { ascending: true })

  if (error) {
    console.error('Error fetching invoices:', error.message)
    return
  }

  console.log(`Found ${invoices.length} invoices with PDFs\n`)

  const results = {
    matched: 0,
    updated: 0,
    noPdf: 0,
    parseError: 0,
    errors: [],
  }

  for (const invoice of invoices) {
    const dbTotal = parseFloat(invoice.total_amount)
    const dbSubtotal = parseFloat(invoice.subtotal) || 0

    // Skip $0 invoices
    if (dbTotal === 0) {
      continue
    }

    // Download PDF
    const { data: pdfData, error: pdfError } = await supabase.storage
      .from('invoices')
      .download(invoice.pdf_path)

    if (pdfError) {
      results.noPdf++
      console.log(`❌ ${invoice.invoice_number}: Could not download PDF - ${pdfError.message}`)
      continue
    }

    const buffer = Buffer.from(await pdfData.arrayBuffer())
    const pdfTotal = await extractTotalFromPDF(buffer)

    if (!pdfTotal) {
      results.parseError++
      console.log(`⚠️  ${invoice.invoice_number}: Could not extract total from PDF`)
      continue
    }

    const diff = Math.abs(dbTotal - pdfTotal)

    if (diff < 0.01) {
      results.matched++
      console.log(`✅ ${invoice.invoice_number}: $${dbTotal.toFixed(2)} ✓`)
    } else {
      // Calculate new markup
      const newMarkup = Math.round((pdfTotal - dbSubtotal) * 100) / 100
      const markupPercent = dbSubtotal > 0 ? (newMarkup / dbSubtotal * 100) : 0

      console.log(`\n📝 ${invoice.invoice_number}: NEEDS UPDATE`)
      console.log(`   DB total_amount: $${dbTotal.toFixed(2)}`)
      console.log(`   PDF total: $${pdfTotal.toFixed(2)}`)
      console.log(`   Difference: $${diff.toFixed(2)}`)
      console.log(`   Current subtotal: $${dbSubtotal.toFixed(2)}`)
      console.log(`   Current markup: $${invoice.total_markup}`)
      console.log(`   New markup: $${newMarkup.toFixed(2)} (${markupPercent.toFixed(1)}%)`)

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('invoices_jetpack')
          .update({
            total_amount: pdfTotal,
            total_markup: newMarkup,
          })
          .eq('id', invoice.id)

        if (updateError) {
          console.log(`   ❌ Update failed: ${updateError.message}`)
          results.errors.push({ invoice: invoice.invoice_number, error: updateError.message })
        } else {
          console.log(`   ✅ Updated`)
          results.updated++
        }
      } else {
        console.log(`   🔍 Would update (dry run)`)
        results.updated++
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`✅ Already matched: ${results.matched}`)
  console.log(`📝 ${dryRun ? 'Would update' : 'Updated'}: ${results.updated}`)
  console.log(`⚠️  No PDF: ${results.noPdf}`)
  console.log(`⚠️  Parse error: ${results.parseError}`)
  console.log(`❌ Errors: ${results.errors.length}`)

  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS:')
    for (const e of results.errors) {
      console.log(`   ${e.invoice}: ${e.error}`)
    }
  }

  console.log(`\n${dryRun ? 'Run with --live to apply changes' : 'Done!'}`)
}

// Parse command line args
const args = process.argv.slice(2)
const dryRun = !args.includes('--live')

fixAllInvoiceTotals(dryRun).catch(console.error)
