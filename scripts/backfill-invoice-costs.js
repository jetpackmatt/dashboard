#!/usr/bin/env node

/**
 * Backfill Invoice Costs
 *
 * For older invoices that were bulk-created without proper cost breakdown:
 * 1. Extract total_amount from the PDF (authoritative source)
 * 2. Calculate subtotal (cost) from transaction data
 * 3. Calculate total_markup = total_amount - subtotal
 * 4. Update the invoice record with pdf_path and xlsx_path
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const PDFParser = require('pdf2json')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Client ID to folder mapping (from database)
const CLIENT_FOLDERS = {
  '6b94c274-0446-4167-9d02-b998f8be59ad': '6b94c274-0446-4167-9d02-b998f8be59ad', // Henson
  'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e': 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e', // Methyl-Life
  'e6220921-695e-41f9-9f49-af3e0cdc828a': 'e6220921-695e-41f9-9f49-af3e0cdc828a', // Eli Health
}

// Manual overrides for invoices with known data issues (wider billing periods, bad data, etc.)
const COST_OVERRIDES = {
  'JPHS-0001-032425': 27710.14, // First Henson invoice - inception to March 23 (wider period)
  // 'JPHS-0018-072125': ???, // Has bad 'cost' data for B2B Case Pick Fee (cost=$1101.60 vs billed=$105.40)
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

async function calculateCostFromTransactions(clientId, periodStart, periodEnd) {
  // Query transactions by charge_date range AND client_id
  // NOTE: We use date range because older invoices have corrupted shipbob_invoice_ids
  // that include ShipBob invoices from multiple weeks
  // IMPORTANT: Supabase returns MAX 1000 rows regardless of .limit() - must paginate!

  const pageSize = 1000
  let lastId = null
  let totalCost = 0
  let transactionCount = 0

  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, cost')
      .eq('client_id', clientId)
      .gte('charge_date', periodStart)
      .lte('charge_date', periodEnd)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data: transactions, error } = await query

    if (error) {
      console.error('Error fetching transactions:', error.message)
      return null
    }

    if (!transactions || transactions.length === 0) break

    for (const tx of transactions) {
      // Use 'cost' field for ALL transaction types
      totalCost += parseFloat(tx.cost) || 0
      transactionCount++
    }

    lastId = transactions[transactions.length - 1].id

    if (transactions.length < pageSize) break // Last page
  }

  return {
    cost: Math.round(totalCost * 100) / 100,
    transactionCount
  }
}

async function backfillInvoiceCosts(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // Get all invoices that need backfill (have negative markup from previous incorrect run)
  // Also include those with total_markup = 0 that weren't processed
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, invoice_date, period_start, period_end, subtotal, total_markup, total_amount, pdf_path, xlsx_path, shipbob_invoice_ids')
    .or('total_markup.lt.0,total_markup.eq.0')
    .in('status', ['approved', 'sent'])
    .order('invoice_date', { ascending: false })

  if (error) {
    console.error('Error fetching invoices:', error)
    return
  }

  console.log(`Found ${invoices.length} invoices to backfill\n`)

  const results = {
    success: 0,
    skipped: 0,
    errors: []
  }

  for (const invoice of invoices) {
    const clientFolder = CLIENT_FOLDERS[invoice.client_id]
    if (!clientFolder) {
      console.log(`⚠️  ${invoice.invoice_number}: Unknown client_id ${invoice.client_id}`)
      results.skipped++
      continue
    }

    const pdfPath = `${clientFolder}/${invoice.invoice_number}/${invoice.invoice_number}.pdf`
    const xlsxPath = `${clientFolder}/${invoice.invoice_number}/${invoice.invoice_number}-details.xlsx`

    console.log(`\n📄 Processing ${invoice.invoice_number}...`)
    console.log(`   Period: ${invoice.period_start?.split('T')[0]} to ${invoice.period_end?.split('T')[0]}`)
    console.log(`   Stored total_amount: $${invoice.total_amount}`)

    // Skip invoices with $0 total_amount (incomplete/test invoices)
    if (parseFloat(invoice.total_amount) === 0) {
      console.log(`   ⏭️  Skipping: total_amount is $0 (incomplete invoice)`)
      results.skipped++
      continue
    }

    // 1. Download and parse PDF to get authoritative total
    const { data: pdfData, error: pdfError } = await supabase.storage
      .from('invoices')
      .download(pdfPath)

    let pdfTotal = null
    if (pdfError) {
      console.log(`   ⚠️  Could not download PDF: ${pdfError.message}`)
    } else {
      const buffer = Buffer.from(await pdfData.arrayBuffer())
      pdfTotal = await extractTotalFromPDF(buffer)
      if (pdfTotal) {
        console.log(`   📑 PDF total extracted: $${pdfTotal.toFixed(2)}`)
      } else {
        console.log(`   ⚠️  Could not extract total from PDF`)
      }
    }

    // 2. Calculate cost from transactions using charge_date range + client_id
    const txResult = await calculateCostFromTransactions(
      invoice.client_id,
      invoice.period_start,
      invoice.period_end
    )

    if (!txResult) {
      console.log(`   ❌ Could not calculate cost from transactions`)
      results.errors.push({ invoice: invoice.invoice_number, error: 'Transaction query failed' })
      continue
    }

    console.log(`   💰 Calculated cost from ${txResult.transactionCount} transactions: $${txResult.cost.toFixed(2)}`)

    // 3. Determine final values
    // PREFER PDF total (authoritative) over stored total_amount (which may be wrong for older invoices)
    const storedTotal = parseFloat(invoice.total_amount)
    let finalTotal = storedTotal

    if (pdfTotal && pdfTotal > 0) {
      if (Math.abs(pdfTotal - storedTotal) > 1) {
        console.log(`   ⚠️  PDF total ($${pdfTotal.toFixed(2)}) differs from stored ($${storedTotal.toFixed(2)}) - using PDF`)
      }
      finalTotal = pdfTotal
    }

    // Check for manual cost override (for invoices with known data issues)
    let finalSubtotal = txResult.cost
    if (COST_OVERRIDES[invoice.invoice_number]) {
      finalSubtotal = COST_OVERRIDES[invoice.invoice_number]
      console.log(`   🔧 Using manual override for cost: $${finalSubtotal.toFixed(2)}`)
    }

    const finalMarkup = Math.round((finalTotal - finalSubtotal) * 100) / 100

    console.log(`   📊 Final values:`)
    console.log(`      subtotal (cost): $${finalSubtotal.toFixed(2)}`)
    console.log(`      total_markup (profit): $${finalMarkup.toFixed(2)}`)
    console.log(`      total_amount: $${finalTotal.toFixed(2)}`)

    // Sanity checks
    const markupPercent = finalSubtotal > 0 ? (finalMarkup / finalSubtotal * 100) : 0
    console.log(`      markup %: ${markupPercent.toFixed(1)}%`)

    if (finalMarkup < 0) {
      console.log(`   ⚠️  Warning: Negative markup! Cost exceeds total.`)
      if (markupPercent < -5) {
        console.log(`   ⏭️  Skipping: Significant negative markup (< -5%) indicates data quality issue`)
        console.log(`      → Add to COST_OVERRIDES with correct value to process`)
        results.skipped++
        continue
      }
    }

    if (!dryRun) {
      // Update the invoice
      const { error: updateError } = await supabase
        .from('invoices_jetpack')
        .update({
          subtotal: finalSubtotal,
          total_markup: finalMarkup,
          total_amount: finalTotal,
          pdf_path: pdfPath,
          xlsx_path: xlsxPath
        })
        .eq('id', invoice.id)

      if (updateError) {
        console.log(`   ❌ Update failed: ${updateError.message}`)
        results.errors.push({ invoice: invoice.invoice_number, error: updateError.message })
      } else {
        console.log(`   ✅ Updated successfully`)
        results.success++
      }
    } else {
      console.log(`   🔍 Would update (dry run)`)
      results.success++
    }
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Summary:`)
  console.log(`  ✅ ${results.success} invoices ${dryRun ? 'would be' : ''} updated`)
  console.log(`  ⏭️  ${results.skipped} invoices skipped`)
  console.log(`  ❌ ${results.errors.length} errors`)

  if (results.errors.length > 0) {
    console.log(`\nErrors:`)
    results.errors.forEach(e => console.log(`  - ${e.invoice}: ${e.error}`))
  }

  console.log(`\n${dryRun ? 'Run with --live to apply changes' : 'Done!'}`)
}

// Parse command line args
const args = process.argv.slice(2)
const dryRun = !args.includes('--live')

backfillInvoiceCosts(dryRun).catch(console.error)
