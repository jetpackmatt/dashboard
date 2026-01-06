/**
 * PDF Invoice Generator
 *
 * Generates PDF summary invoices using @react-pdf/renderer.
 * Format matches the reference invoices EXACTLY.
 */

import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Image, Font } from '@react-pdf/renderer'
import type { InvoiceData } from './invoice-generator'
import path from 'path'

// Register Outfit font
Font.register({
  family: 'Outfit',
  fonts: [
    { src: path.join(process.cwd(), 'public/fonts/outfit/outfit-latin-300-normal.woff'), fontWeight: 300 },
    { src: path.join(process.cwd(), 'public/fonts/outfit/outfit-latin-400-normal.woff'), fontWeight: 400 },
    { src: path.join(process.cwd(), 'public/fonts/outfit/outfit-latin-500-normal.woff'), fontWeight: 500 },
    { src: path.join(process.cwd(), 'public/fonts/outfit/outfit-latin-700-normal.woff'), fontWeight: 700 },
  ],
})

// Colors - pure black text
const BLACK = '#000000'
const GREY_BG = '#f5f5f5'

// Styles matching reference PDF exactly (font sizes +1 point)
const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingTop: 35,
    paddingBottom: 35,
    fontSize: 10,
    fontFamily: 'Outfit',
    fontWeight: 400,
    color: BLACK,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  invoiceTitle: {
    fontSize: 23,
    fontWeight: 300,
    color: BLACK,
  },
  logo: {
    width: 100,
    height: 27,
  },
  // Invoice details section
  invoiceDetails: {
    marginBottom: 12,
  },
  invoiceDetailRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  invoiceDetailLabel: {
    fontSize: 10,
    fontWeight: 500,
    width: 90,
  },
  invoiceDetailValue: {
    fontSize: 10,
    fontWeight: 400,
  },
  // Addresses
  addressSection: {
    flexDirection: 'row',
    marginBottom: 15,
    marginTop: 8,
  },
  addressBlock: {
    width: '50%',
  },
  addressLabel: {
    fontSize: 10,
    fontWeight: 500,
    marginBottom: 3,
  },
  addressLine: {
    fontSize: 10,
    fontWeight: 400,
    marginBottom: 1,
    lineHeight: 1.3,
  },
  // Due amount headline - amount bold, date lighter
  dueHeadlineContainer: {
    flexDirection: 'row',
    marginBottom: 15,
    marginTop: 8,
  },
  dueHeadlineAmount: {
    fontSize: 17,
    fontWeight: 700,
    color: BLACK,
  },
  dueHeadlineText: {
    fontSize: 17,
    fontWeight: 500,
    color: BLACK,
  },
  // Table - full width grey header, no background on data rows
  table: {
    marginBottom: 0,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: GREY_BG,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 10,
    fontWeight: 500,
    color: BLACK,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableCell: {
    fontSize: 10,
    fontWeight: 400,
  },
  // Column widths - Service wider to push Period right
  colService: { width: '45%' },
  colPeriod: { width: '35%' },
  colAmount: { width: '20%', textAlign: 'right' },
  // Totals section - partial grey background (right side only)
  totalsSection: {
    marginTop: 0,
  },
  totalRowContainer: {
    flexDirection: 'row',
  },
  totalRowLeft: {
    width: '44%',
  },
  totalRowRight: {
    width: '56%',
    flexDirection: 'row',
    backgroundColor: GREY_BG,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 8,
  },
  totalLabel: {
    width: '65%',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 400,
  },
  totalLabelBold: {
    width: '65%',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 700,
  },
  totalValue: {
    width: '35%',
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 400,
  },
  totalValueBold: {
    width: '35%',
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 700,
  },
  // Footer notes
  footerNotes: {
    marginTop: 20,
    paddingTop: 12,
  },
  footerText: {
    fontSize: 9,
    fontWeight: 400,
    color: BLACK,
    marginBottom: 3,
    lineHeight: 1.3,
  },
  // ACH section
  achSection: {
    marginTop: 15,
  },
  achTitle: {
    fontSize: 10,
    fontWeight: 500,
    marginBottom: 4,
  },
  achRow: {
    fontSize: 9,
    fontWeight: 400,
    color: BLACK,
    marginBottom: 1,
    lineHeight: 1.3,
  },
})

interface InvoicePDFProps {
  data: InvoiceData
  billingPeriodLabel: string
  storagePeriodLabel?: string
  clientAddress?: {
    street: string
    city: string
    region: string
    postalCode: string
    country: string
  }
  currency: string
}

// Service categories in order
const SERVICE_ORDER = [
  { key: 'shipping', label: 'Shipping' },
  { key: 'additional', label: 'Additional Services (Extra picks, B2B, etc)' },
  { key: 'returns', label: 'Returns' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'storage', label: 'Storage' },
  { key: 'credits', label: 'Credits' },
] as const

// Map internal categories to display categories
function aggregateByServiceType(data: InvoiceData): Map<string, number> {
  const totals = new Map<string, number>()

  for (const item of data.lineItems) {
    let serviceKey: string

    switch (item.lineCategory) {
      case 'Shipping':
      case 'Fulfillment':
        serviceKey = 'shipping'
        break
      case 'Pick Fees':
      case 'B2B Fees':
      case 'Additional Services':
        serviceKey = 'additional'
        break
      case 'Returns':
        serviceKey = 'returns'
        break
      case 'Receiving':
        serviceKey = 'receiving'
        break
      case 'Storage':
        serviceKey = 'storage'
        break
      case 'Credits':
        serviceKey = 'credits'
        break
      default:
        serviceKey = 'additional'
    }

    const current = totals.get(serviceKey) || 0
    totals.set(serviceKey, current + item.billedAmount)
  }

  return totals
}

function formatCurrency(amount: number, currency: string): string {
  const absAmount = Math.abs(amount)
  const formatted = absAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const symbol = currency === 'CAD' ? 'C$' : currency === 'EUR' ? '€' : '$'

  if (amount < 0) {
    return `${symbol} (${formatted})`
  }
  return `${symbol} ${formatted}`
}

function formatDate(dateStr: string): string {
  // Parse YYYY-MM-DD as LOCAL date (not UTC) to avoid timezone shift
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatShortDate(dateStr: string): string {
  // Parse YYYY-MM-DD as LOCAL date (not UTC) to avoid timezone shift
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// PDF Document Component - matches reference EXACTLY
const InvoicePDF: React.FC<InvoicePDFProps> = ({
  data,
  billingPeriodLabel,
  storagePeriodLabel,
  clientAddress,
  currency,
}) => {
  const serviceTotals = aggregateByServiceType(data)
  const dueDate = formatDate(data.invoice.invoice_date)
  const logoPath = path.join(process.cwd(), 'public/images/jetpack-logo.png')

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header - Invoice title and Jetpack logo */}
        <View style={styles.header}>
          <Text style={styles.invoiceTitle}>Invoice</Text>
          <Image src={logoPath} style={styles.logo} />
        </View>

        {/* Invoice Details */}
        <View style={styles.invoiceDetails}>
          <View style={styles.invoiceDetailRow}>
            <Text style={styles.invoiceDetailLabel}>Invoice Number:</Text>
            <Text style={styles.invoiceDetailValue}>{data.invoice.invoice_number}</Text>
          </View>
          <View style={styles.invoiceDetailRow}>
            <Text style={styles.invoiceDetailLabel}>Date of Issue:</Text>
            <Text style={styles.invoiceDetailValue}>{dueDate}</Text>
          </View>
          <View style={styles.invoiceDetailRow}>
            <Text style={styles.invoiceDetailLabel}>Payment Due:</Text>
            <Text style={styles.invoiceDetailValue}>Upon Receipt</Text>
          </View>
        </View>

        {/* Addresses - Bill From / Bill To */}
        <View style={styles.addressSection}>
          <View style={styles.addressBlock}>
            <Text style={styles.addressLabel}>Bill from:</Text>
            <Text style={styles.addressLine}>Jetpack Ventures Inc.</Text>
            <Text style={styles.addressLine}>2-1398 Queen St W</Text>
            <Text style={styles.addressLine}>Toronto, ON</Text>
            <Text style={styles.addressLine}>M6K 1L7, CANADA</Text>
          </View>
          <View style={styles.addressBlock}>
            <Text style={styles.addressLabel}>Bill To:</Text>
            <Text style={styles.addressLine}>{data.client.company_name}</Text>
            {clientAddress ? (
              <>
                <Text style={styles.addressLine}>{clientAddress.street}</Text>
                <Text style={styles.addressLine}>{clientAddress.city}, {clientAddress.region}</Text>
                <Text style={styles.addressLine}>{clientAddress.postalCode}, {clientAddress.country}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Due Amount Headline - amount bold, date lighter */}
        <View style={styles.dueHeadlineContainer}>
          <Text style={styles.dueHeadlineAmount}>
            {formatCurrency(data.summary.totalAmount, currency).replace(' ', '')}
          </Text>
          <Text style={styles.dueHeadlineText}> due {dueDate}</Text>
        </View>

        {/* Service Line Items Table */}
        <View style={styles.table}>
          {/* Header - full width grey background */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colService]}>Service</Text>
            <Text style={[styles.tableHeaderCell, styles.colPeriod]}>Billing Period</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>Amount ({currency})</Text>
          </View>

          {/* Service Rows - no background */}
          {SERVICE_ORDER.map(service => {
            const amount = serviceTotals.get(service.key)
            if (amount === undefined || amount === 0) return null

            // Storage uses different period
            const period = service.key === 'storage' && storagePeriodLabel
              ? storagePeriodLabel
              : billingPeriodLabel

            return (
              <View key={service.key} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.colService]}>{service.label}</Text>
                <Text style={[styles.tableCell, styles.colPeriod]}>{period}</Text>
                <Text style={[styles.tableCell, styles.colAmount]}>{formatCurrency(amount, currency)}</Text>
              </View>
            )
          })}
        </View>

        {/* Totals - all rows have grey background on right side */}
        <View style={styles.totalsSection}>
          {/* Subtotal (before tax) */}
          <View style={styles.totalRowContainer}>
            <View style={styles.totalRowLeft} />
            <View style={styles.totalRowRight}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(data.summary.totalAmount - (data.summary.totalTax || 0), currency)}
              </Text>
            </View>
          </View>

          {/* Tax lines (GST, HST, etc.) - only show if taxes exist */}
          {data.summary.taxBreakdown && Object.keys(data.summary.taxBreakdown).length > 0 && (
            Object.entries(data.summary.taxBreakdown).map(([taxType, taxData]) => (
              <View key={taxType} style={styles.totalRowContainer}>
                <View style={styles.totalRowLeft} />
                <View style={styles.totalRowRight}>
                  <Text style={styles.totalLabel}>{taxType} ({taxData.rate}%)</Text>
                  <Text style={styles.totalValue}>{formatCurrency(taxData.amount, currency)}</Text>
                </View>
              </View>
            ))
          )}

          {/* Total (including tax) */}
          <View style={styles.totalRowContainer}>
            <View style={styles.totalRowLeft} />
            <View style={styles.totalRowRight}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(data.summary.totalAmount, currency)}</Text>
            </View>
          </View>

          {/* Amount Due */}
          <View style={styles.totalRowContainer}>
            <View style={styles.totalRowLeft} />
            <View style={styles.totalRowRight}>
              <Text style={styles.totalLabelBold}>Amount Due ({currency})</Text>
              <Text style={styles.totalValueBold}>{formatCurrency(data.summary.totalAmount, currency)}</Text>
            </View>
          </View>
        </View>

        {/* Footer Notes */}
        <View style={styles.footerNotes}>
          <Text style={styles.footerText}>
            For transactional details regarding any service category, please review the included spreadsheet.
          </Text>
          <Text style={styles.footerText}>
            Have questions? Email us at billing@shipwithjetpack.com.
          </Text>
        </View>

        {/* ACH Payment Details */}
        <View style={styles.achSection}>
          <Text style={styles.achTitle}>ACH Payments Details:</Text>
          <Text style={styles.achRow}>Account Currency: USD</Text>
          <Text style={styles.achRow}>Account Holder: Jetpack Ventures Inc.</Text>
          <Text style={styles.achRow}>Account Type: Checking</Text>
          <Text style={styles.achRow}>Account Number: 489159369530363</Text>
          <Text style={styles.achRow}>Routing Number: 084009519</Text>
          <Text style={styles.achRow}>Bank name: Column National Association</Text>
          <Text style={styles.achRow}>Bank address: 30 W. 26th Street, Sixth Floor, New York, NY, 10010, USA</Text>
        </View>
      </Page>
    </Document>
  )
}

/**
 * Generate PDF invoice buffer
 */
export async function generatePDFInvoice(
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
  const billingPeriodLabel = `${formatShortDate(data.invoice.period_start)} - ${formatShortDate(data.invoice.period_end)}`

  // Storage period may be different (semi-monthly or monthly)
  let storagePeriodLabel: string | undefined
  if (options?.storagePeriodStart && options?.storagePeriodEnd) {
    storagePeriodLabel = `${formatShortDate(options.storagePeriodStart)} - ${formatShortDate(options.storagePeriodEnd)}`
  }

  // Default to USD if no currency specified
  const currency = options?.currency || 'USD'

  const pdfBuffer = await renderToBuffer(
    <InvoicePDF
      data={data}
      billingPeriodLabel={billingPeriodLabel}
      storagePeriodLabel={storagePeriodLabel}
      clientAddress={options?.clientAddress}
      currency={currency}
    />
  )

  return Buffer.from(pdfBuffer)
}
