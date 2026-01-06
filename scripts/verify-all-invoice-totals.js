#!/usr/bin/env node

/**
 * Verify All Invoice Totals Against PDFs
 *
 * Downloads every invoice PDF from Supabase storage and compares
 * the extracted total to the database total_amount field.
 * Reports any discrepancies.
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

async function verifyAllInvoiceTotals() {
  console.log('\n📊 Verifying ALL invoice totals against PDFs...\n')

  // Get all invoices with PDF paths
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, total_amount, pdf_path')
    .not('pdf_path', 'is', null)
    .in('status', ['approved', 'sent'])
    .order('invoice_number', { ascending: true })

  if (error) {
    console.error('Error fetching invoices:', error.message)
    return
  }

  console.log(`Found ${invoices.length} invoices with PDFs\n`)

  const results = {
    matched: [],
    mismatched: [],
    noPdf: [],
    parseError: [],
  }

  for (const invoice of invoices) {
    const dbTotal = parseFloat(invoice.total_amount)

    // Skip $0 invoices
    if (dbTotal === 0) {
      continue
    }

    // Download PDF
    const { data: pdfData, error: pdfError } = await supabase.storage
      .from('invoices')
      .download(invoice.pdf_path)

    if (pdfError) {
      results.noPdf.push({ invoice: invoice.invoice_number, error: pdfError.message })
      console.log(`❌ ${invoice.invoice_number}: Could not download PDF`)
      continue
    }

    const buffer = Buffer.from(await pdfData.arrayBuffer())
    const pdfTotal = await extractTotalFromPDF(buffer)

    if (!pdfTotal) {
      results.parseError.push({ invoice: invoice.invoice_number })
      console.log(`⚠️  ${invoice.invoice_number}: Could not extract total from PDF`)
      continue
    }

    const diff = Math.abs(dbTotal - pdfTotal)

    if (diff < 0.01) {
      results.matched.push(invoice.invoice_number)
      console.log(`✅ ${invoice.invoice_number}: $${dbTotal.toFixed(2)} ✓`)
    } else {
      results.mismatched.push({
        invoice: invoice.invoice_number,
        dbTotal,
        pdfTotal,
        diff,
      })
      console.log(`❌ ${invoice.invoice_number}: DB=$${dbTotal.toFixed(2)} vs PDF=$${pdfTotal.toFixed(2)} (diff: $${diff.toFixed(2)})`)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`✅ Matched: ${results.matched.length}`)
  console.log(`❌ Mismatched: ${results.mismatched.length}`)
  console.log(`⚠️  No PDF: ${results.noPdf.length}`)
  console.log(`⚠️  Parse error: ${results.parseError.length}`)

  if (results.mismatched.length > 0) {
    console.log('\n❌ MISMATCHED INVOICES:')
    for (const m of results.mismatched) {
      console.log(`   ${m.invoice}: DB=$${m.dbTotal.toFixed(2)} vs PDF=$${m.pdfTotal.toFixed(2)} (diff: $${m.diff.toFixed(2)})`)
    }
  }

  if (results.noPdf.length > 0) {
    console.log('\n⚠️  MISSING PDFs:')
    for (const m of results.noPdf) {
      console.log(`   ${m.invoice}: ${m.error}`)
    }
  }
}

verifyAllInvoiceTotals().catch(console.error)
