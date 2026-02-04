import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120 // 2 minutes for large files

/**
 * POST /api/admin/eshipper-upload
 *
 * Upload and process an eShipper CSV export file.
 * Creates/updates clients and inserts shipment records.
 * Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
    let access
    try {
      access = await verifyClientAccess(null)
    } catch (error) {
      return handleAccessError(error)
    }

    if (!access.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
    }

    console.log(`Processing eShipper CSV: ${file.name} (${file.size} bytes)`)

    // Read file content
    const content = await file.text()
    const lines = content.split('\n').filter(line => line.trim())

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV file appears empty or has no data rows' }, { status: 400 })
    }

    // Parse header
    const headers = parseCSVLine(lines[0])
    const headerIndex: Record<string, number> = {}
    headers.forEach((h, i) => { headerIndex[h] = i })

    // Required columns
    const requiredColumns = ['Company Name', 'Company ID#', 'Ship Date', 'Tracking#', 'Total Charge']
    const missingColumns = requiredColumns.filter(col => headerIndex[col] === undefined)
    if (missingColumns.length > 0) {
      return NextResponse.json({
        error: `Missing required columns: ${missingColumns.join(', ')}`,
      }, { status: 400 })
    }

    // Collect unique companies
    const companies = new Map<string, string>() // eshipper_id -> company_name

    // Parse all rows
    const shipments: EshipperShipmentRecord[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])

      const companyName = values[headerIndex['Company Name']]
      const companyId = values[headerIndex['Company ID#']]
      const trackingNumber = values[headerIndex['Tracking#']]
      const shipDate = parseDate(values[headerIndex['Ship Date']])

      if (!companyName || !companyId || !trackingNumber || !shipDate) {
        continue // Skip invalid rows
      }

      // Track unique companies
      if (!companies.has(companyId)) {
        companies.set(companyId, companyName)
      }

      // Build shipment record
      shipments.push({
        eshipper_company_id: companyId,
        eshipper_company_name: companyName,
        tracking_number: trackingNumber,
        transaction_number: cleanString(values[headerIndex['Transaction#']]),
        order_date: parseDate(values[headerIndex['Order Date']]),
        ship_date: shipDate,
        delivery_date: parseDate(values[headerIndex['Delivery Date']]),
        carrier: cleanString(values[headerIndex['Carrier']]),
        carrier_service: cleanString(values[headerIndex['Carrier Service Name']]),
        status: cleanString(values[headerIndex['Status']]),
        ship_from_country: cleanString(values[headerIndex['ShipFrom Country']]),
        ship_from_postal: cleanString(values[headerIndex['ShipFrom Zip/Postal']]),
        ship_from_city: cleanString(values[headerIndex['ShipFrom City']]),
        ship_from_province: cleanString(values[headerIndex['ShipFrom Province']]),
        ship_to_country: cleanString(values[headerIndex['ShipTo Country']]),
        ship_to_postal: cleanString(values[headerIndex['ShipTo Zip/Postal']]),
        ship_to_city: cleanString(values[headerIndex['ShipTo City']]),
        ship_to_province: cleanString(values[headerIndex['ShipTo Province']]),
        is_residential: parseBoolean(values[headerIndex['Is Residential']]),
        currency: cleanString(values[headerIndex['Currency']]) || 'CAD',
        base_charge: parseDecimal(values[headerIndex['Base Charge']]),
        fuel_surcharge: parseDecimal(values[headerIndex['Fuel Surcharge']]),
        total_surcharges: parseDecimal(values[headerIndex['Total Surcharges']]),
        total_charge: parseDecimal(values[headerIndex['Total Charge']]) || 0,
        // Note: CSV header has a leading space: " Commission Amount"
        commission_amount: parseDecimal(values[headerIndex[' Commission Amount']]),
        commissionable: parseBoolean(values[headerIndex[' Commissionable']]),
        reference_1: cleanString(values[headerIndex['Reference 1']]),
        reference_2: cleanString(values[headerIndex['Reference 2']]),
        reference_3: cleanString(values[headerIndex['Reference 3']]),
        tracking_url: cleanString(values[headerIndex['Tracking URL']]),
        payment_type: cleanString(values[headerIndex['Shipment Payment type']]),
        import_source: file.name,
      })
    }

    console.log(`Parsed ${shipments.length} shipments from ${companies.size} companies`)

    const supabase = createAdminClient()

    // Step 1: Create/update clients
    const clientMap = new Map<string, string>() // eshipper_company_id -> client_id
    const clientsCreated: string[] = []
    const clientsLinked: string[] = []

    for (const [eshipperCompanyId, companyName] of companies) {
      // Check if client already exists with this eshipper_id
      const { data: existingByEshipper } = await supabase
        .from('clients')
        .select('id, company_name')
        .eq('eshipper_id', eshipperCompanyId)
        .single()

      if (existingByEshipper) {
        clientMap.set(eshipperCompanyId, existingByEshipper.id)
        continue
      }

      // Check if client exists by name
      const { data: existingByName } = await supabase
        .from('clients')
        .select('id, company_name, eshipper_id')
        .ilike('company_name', companyName)
        .single()

      if (existingByName) {
        // Update existing client with eshipper_id
        const { error: updateError } = await supabase
          .from('clients')
          .update({ eshipper_id: eshipperCompanyId })
          .eq('id', existingByName.id)

        if (!updateError) {
          clientMap.set(eshipperCompanyId, existingByName.id)
          clientsLinked.push(companyName)
        }
        continue
      }

      // Create new client
      const { data: newClient, error: insertError } = await supabase
        .from('clients')
        .insert({
          company_name: companyName,
          eshipper_id: eshipperCompanyId,
          is_active: true,
          billing_currency: 'CAD',
        })
        .select('id')
        .single()

      if (!insertError && newClient) {
        clientMap.set(eshipperCompanyId, newClient.id)
        clientsCreated.push(companyName)
      }
    }

    // Add client_id to shipments
    for (const shipment of shipments) {
      shipment.client_id = clientMap.get(shipment.eshipper_company_id) || null
    }

    // Step 2: Insert shipments in batches
    const batchSize = 500
    let inserted = 0
    let errors = 0

    for (let i = 0; i < shipments.length; i += batchSize) {
      const batch = shipments.slice(i, i + batchSize)

      const { error } = await supabase
        .from('eshipper_shipments')
        .upsert(batch, {
          onConflict: 'tracking_number',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error(`Batch error (rows ${i + 1}-${i + batch.length}): ${error.message}`)
        errors += batch.length
      } else {
        inserted += batch.length
      }
    }

    // Get date range
    let dateRange = { min: '', max: '' }
    if (shipments.length > 0) {
      const dates = shipments.map(s => s.ship_date).filter(Boolean).sort()
      dateRange = {
        min: dates[0] || '',
        max: dates[dates.length - 1] || '',
      }
    }

    // Get counts by company
    const countByCompany: Record<string, number> = {}
    for (const s of shipments) {
      countByCompany[s.eshipper_company_name] = (countByCompany[s.eshipper_company_name] || 0) + 1
    }

    return NextResponse.json({
      success: errors === 0,
      filename: file.name,
      rowsProcessed: shipments.length,
      rowsFailed: errors,
      clientsCreated,
      clientsLinked,
      dateRange,
      byCompany: countByCompany,
    })
  } catch (error) {
    console.error('Error processing eShipper upload:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

// Type for shipment record
interface EshipperShipmentRecord {
  client_id?: string | null
  eshipper_company_id: string
  eshipper_company_name: string
  tracking_number: string
  transaction_number: string | null
  order_date: string | null
  ship_date: string
  delivery_date: string | null
  carrier: string | null
  carrier_service: string | null
  status: string | null
  ship_from_country: string | null
  ship_from_postal: string | null
  ship_from_city: string | null
  ship_from_province: string | null
  ship_to_country: string | null
  ship_to_postal: string | null
  ship_to_city: string | null
  ship_to_province: string | null
  is_residential: boolean | null
  currency: string
  base_charge: number | null
  fuel_surcharge: number | null
  total_surcharges: number | null
  total_charge: number
  commission_amount: number | null
  commissionable: boolean | null
  reference_1: string | null
  reference_2: string | null
  reference_3: string | null
  tracking_url: string | null
  payment_type: string | null
  import_source: string
}

// CSV parsing helpers
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr || dateStr === '-') return null

  // Handle MM/DD/YYYY format
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    const [month, day, year] = parts
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return null
}

function parseBoolean(str: string | undefined): boolean | null {
  if (!str || str === '-') return null
  return str.toLowerCase() === 'true'
}

function parseDecimal(str: string | undefined): number | null {
  if (!str || str === '-' || str === '') return null
  const num = parseFloat(str)
  return isNaN(num) ? null : num
}

function cleanString(str: string | undefined): string | null {
  if (!str || str === '-') return null
  return str.trim() || null
}
