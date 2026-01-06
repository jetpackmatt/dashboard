/**
 * Fix Approved Invoice Files
 *
 * This script regenerates XLSX/PDF files for approved invoices
 * WITHOUT changing any amounts or status. Used to fix the Shipment ID column bug.
 *
 * Usage: node scripts/fix-approved-invoice-files.js [invoiceId]
 *
 * If no invoiceId is provided, lists all approved invoices.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listApprovedInvoices() {
  const { data, error } = await supabase
    .from('invoices_jetpack')
    .select(`
      id, invoice_number, status, client_id, version, generated_at,
      client:clients(company_name)
    `)
    .in('status', ['approved', 'sent'])
    .order('generated_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching invoices:', error);
    return;
  }

  console.log('\n=== APPROVED/SENT INVOICES ===\n');
  data.forEach(inv => {
    console.log(`  ${inv.invoice_number} (${inv.client?.company_name}) - ${inv.status} v${inv.version}`);
    console.log(`    ID: ${inv.id}`);
    console.log(`    Generated: ${inv.generated_at}`);
    console.log('');
  });

  console.log('To regenerate files for a specific invoice:');
  console.log('  node scripts/fix-approved-invoice-files.js <invoiceId>');
  console.log('');
  console.log('NOTE: This will ONLY regenerate files, not change any amounts.');
}

async function regenerateFilesForInvoice(invoiceId) {
  console.log(`\n=== Regenerating files for invoice ${invoiceId} ===\n`);

  // Get the invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select(`
      *,
      client:clients(id, company_name, short_code, billing_email, billing_terms, merchant_id, billing_address)
    `)
    .eq('id', invoiceId)
    .single();

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError);
    return;
  }

  console.log(`Invoice: ${invoice.invoice_number}`);
  console.log(`Client: ${invoice.client?.company_name}`);
  console.log(`Status: ${invoice.status}`);
  console.log(`Amount: $${invoice.total_amount.toLocaleString()}`);
  console.log(`ShipBob Invoice IDs: ${invoice.shipbob_invoice_ids?.join(', ')}`);

  if (!['approved', 'sent'].includes(invoice.status)) {
    console.log('\nThis invoice is not approved/sent. Use the regular regenerate endpoint instead.');
    return;
  }

  // Dynamically import the ES modules
  console.log('\nLoading invoice generator modules...');

  // We need to use dynamic import for ESM modules
  const {
    collectBillingTransactionsByInvoiceIds,
    collectDetailedBillingDataByInvoiceIds,
    applyMarkupsToLineItems,
    generateSummary,
    generateExcelInvoice,
    storeInvoiceFiles,
  } = await import('../lib/billing/invoice-generator.js');

  const { generatePDFViaSubprocess } = await import('../lib/billing/pdf-subprocess.js');

  const client = invoice.client;
  const shipbobInvoiceIds = invoice.shipbob_invoice_ids || [];

  if (shipbobInvoiceIds.length === 0) {
    console.error('No ShipBob invoice IDs found on this invoice');
    return;
  }

  console.log(`\nCollecting billing data for ${shipbobInvoiceIds.length} ShipBob invoices...`);

  // Collect line items and detailed data
  let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds);
  console.log(`Found ${lineItems.length} transactions`);

  lineItems = await applyMarkupsToLineItems(client.id, lineItems);
  const summary = generateSummary(lineItems);

  console.log(`Summary: Subtotal=$${summary.subtotal.toFixed(2)}, Markup=$${summary.totalMarkup.toFixed(2)}, Total=$${summary.totalAmount.toFixed(2)}`);

  // Calculate storage period
  const parseDateAsLocal = (dateStr) => {
    if (dateStr.length === 10 && dateStr.includes('-')) {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    return new Date(dateStr);
  };

  const storageDates = lineItems
    .filter(item => item.lineCategory === 'Storage')
    .map(item => parseDateAsLocal(item.transactionDate));

  let storagePeriodStart, storagePeriodEnd;

  if (storageDates.length > 0) {
    const minStorageDate = new Date(Math.min(...storageDates.map(d => d.getTime())));
    const maxStorageDate = new Date(Math.max(...storageDates.map(d => d.getTime())));

    const storageMonth = minStorageDate.getMonth();
    const storageYear = minStorageDate.getFullYear();
    const dayMin = minStorageDate.getDate();
    const dayMax = maxStorageDate.getDate();

    if (dayMin <= 15 && dayMax > 15) {
      storagePeriodStart = new Date(storageYear, storageMonth, 1);
      storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0);
    } else if (dayMax <= 15) {
      storagePeriodStart = new Date(storageYear, storageMonth, 1);
      storagePeriodEnd = new Date(storageYear, storageMonth, 15);
    } else {
      storagePeriodStart = new Date(storageYear, storageMonth, 16);
      storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0);
    }
  }

  const formatLocalDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Generate invoice data structure
  const invoiceData = {
    invoice: {
      ...invoice,
      subtotal: summary.subtotal,
      total_markup: summary.totalMarkup,
      total_amount: summary.totalAmount,
    },
    client: {
      id: client.id,
      company_name: client.company_name,
      short_code: client.short_code,
      billing_email: client.billing_email,
      billing_terms: client.billing_terms || 'due_on_receipt',
      merchant_id: client.merchant_id || null,
    },
    lineItems,
    summary,
  };

  console.log('\nCollecting detailed data...');
  const detailedData = await collectDetailedBillingDataByInvoiceIds(client.id, shipbobInvoiceIds);
  console.log(`  Shipments: ${detailedData.shipments.length}`);
  console.log(`  Fees: ${detailedData.shipmentFees.length}`);
  console.log(`  Returns: ${detailedData.returns.length}`);
  console.log(`  Storage: ${detailedData.storage.length}`);
  console.log(`  Receiving: ${detailedData.receiving.length}`);
  console.log(`  Credits: ${detailedData.credits.length}`);

  console.log('\nGenerating Excel file...');
  const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData);
  console.log(`Excel buffer size: ${xlsBuffer.length} bytes`);

  console.log('\nGenerating PDF file...');
  const pdfBuffer = await generatePDFViaSubprocess(invoiceData, {
    storagePeriodStart: storagePeriodStart ? formatLocalDate(storagePeriodStart) : undefined,
    storagePeriodEnd: storagePeriodEnd ? formatLocalDate(storagePeriodEnd) : undefined,
    clientAddress: client.billing_address || undefined,
  });
  console.log(`PDF buffer size: ${pdfBuffer.length} bytes`);

  console.log('\nUploading files to storage...');
  await storeInvoiceFiles(invoice.id, client.id, invoice.invoice_number, xlsBuffer, pdfBuffer);

  console.log('\n=== SUCCESS ===');
  console.log(`Regenerated files for ${invoice.invoice_number}`);
  console.log('The Shipment ID column should now be correct.');
}

async function main() {
  const invoiceId = process.argv[2];

  if (!invoiceId) {
    await listApprovedInvoices();
  } else {
    await regenerateFilesForInvoice(invoiceId);
  }
}

main().catch(console.error);
