import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { startOfWeek, endOfWeek, addDays } from 'date-fns'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { weekStart, customerId } = body

    if (!weekStart || !customerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const weekStartDate = new Date(weekStart)
    const weekEndDate = endOfWeek(weekStartDate)

    // Get shipments for this week that don't have an invoice
    const shipments = await prisma.shipment.findMany({
      where: {
        customerId,
        shipmentDate: {
          gte: weekStartDate,
          lte: weekEndDate,
        },
        invoiceId: null,
      },
    })

    if (shipments.length === 0) {
      return NextResponse.json(
        { error: 'No uninvoiced shipments found for this week' },
        { status: 400 }
      )
    }

    // Calculate totals
    const subtotal = shipments.reduce((sum, s) => sum + s.shippingCost, 0)
    const taxRate = 0.08 // 8% tax
    const taxAmount = subtotal * taxRate
    const totalAmount = subtotal + taxAmount

    // Generate invoice number
    const invoiceCount = await prisma.invoice.count()
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(6, '0')}`

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        customerId,
        issueDate: new Date(),
        dueDate: addDays(new Date(), 30),
        weekStartDate,
        weekEndDate,
        status: 'PENDING',
        subtotal,
        taxRate,
        taxAmount,
        totalAmount,
        lineItems: {
          create: [
            {
              description: `Shipping services for week of ${weekStartDate.toLocaleDateString()}`,
              quantity: shipments.length,
              unitPrice: subtotal / shipments.length,
              amount: subtotal,
            },
          ],
        },
      },
    })

    // Update shipments with invoice ID
    await prisma.shipment.updateMany({
      where: {
        id: { in: shipments.map(s => s.id) },
      },
      data: {
        invoiceId: invoice.id,
      },
    })

    return NextResponse.json({
      success: true,
      invoice,
      shipmentsCount: shipments.length,
    })
  } catch (error) {
    console.error('Invoice generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate invoice' },
      { status: 500 }
    )
  }
}
