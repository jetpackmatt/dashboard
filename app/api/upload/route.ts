import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import Papa from 'papaparse'

// Helper to get or create demo customer
async function getDemoCustomer() {
  let customer = await prisma.customer.findFirst({
    where: { email: 'demo@example.com' }
  })

  if (!customer) {
    const bcrypt = require('bcryptjs')
    customer = await prisma.customer.create({
      data: {
        email: 'demo@example.com',
        password: await bcrypt.hash('demo123', 10),
        companyName: 'Demo Company Inc.',
        contactName: 'Demo Customer',
        phone: '555-0123',
        address: '123 Demo Street, Demo City, DC 12345',
      },
    })
  }

  return customer
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must be a CSV' },
        { status: 400 }
      )
    }

    // Read file content
    const text = await file.text()

    // Parse CSV
    const results = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.toLowerCase().trim().replace(/ /g, '_'),
    })

    if (results.errors.length > 0) {
      return NextResponse.json(
        { error: 'CSV parsing error', details: results.errors },
        { status: 400 }
      )
    }

    const customer = await getDemoCustomer()
    const shipments = []

    // Process each row
    for (const row of results.data as any[]) {
      try {
        // Validate required fields
        if (!row.tracking_number || !row.shipment_date || !row.shipping_cost) {
          continue // Skip invalid rows
        }

        // Check if shipment already exists
        const existing = await prisma.shipment.findUnique({
          where: { trackingNumber: row.tracking_number }
        })

        if (existing) {
          continue // Skip duplicates
        }

        const shipment = await prisma.shipment.create({
          data: {
            customerId: customer.id,
            trackingNumber: row.tracking_number,
            shipmentDate: new Date(row.shipment_date),
            origin: row.origin || 'Unknown',
            destination: row.destination || 'Unknown',
            weight: parseFloat(row.weight) || 0,
            dimensions: row.dimensions || null,
            packageType: row.package_type || null,
            serviceType: row.service_type || 'Standard',
            carrier: row.carrier || null,
            status: row.status?.toUpperCase() || 'IN_TRANSIT',
            deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
            shippingCost: parseFloat(row.shipping_cost) || 0,
            rawData: JSON.stringify(row),
          },
        })

        shipments.push(shipment)
      } catch (error) {
        console.error('Error processing row:', error)
        // Continue processing other rows
      }
    }

    return NextResponse.json({
      success: true,
      message: 'CSV processed successfully',
      count: shipments.length,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to process upload' },
      { status: 500 }
    )
  }
}
