import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting seed...')

  // Create demo customer
  const customer = await prisma.customer.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      password: await bcrypt.hash('demo123', 10),
      companyName: 'Acme Corporation',
      contactName: 'John Doe',
      phone: '555-0100',
      address: '123 Business Ave, Commerce City, CC 12345',
    },
  })

  console.log('Created customer:', customer.email)

  // Create sample shipments
  const shipments = []
  const today = new Date()
  
  for (let i = 0; i < 20; i++) {
    const shipmentDate = new Date(today)
    shipmentDate.setDate(today.getDate() - i)

    const shipment = await prisma.shipment.create({
      data: {
        customerId: customer.id,
        trackingNumber: `TRK${String(10000 + i).padStart(6, '0')}`,
        shipmentDate,
        origin: i % 2 === 0 ? 'New York, NY' : 'Los Angeles, CA',
        destination: i % 2 === 0 ? 'Chicago, IL' : 'Houston, TX',
        weight: 5 + Math.random() * 45,
        dimensions: '12x10x8',
        packageType: ['Box', 'Envelope', 'Pallet'][i % 3],
        serviceType: ['Standard', 'Express', 'Overnight'][i % 3],
        carrier: ['UPS', 'FedEx', 'USPS'][i % 3],
        status: i < 15 ? 'DELIVERED' : 'IN_TRANSIT',
        deliveredAt: i < 15 ? new Date(shipmentDate.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
        shippingCost: 15 + Math.random() * 85,
      },
    })
    shipments.push(shipment)
  }

  console.log(`Created ${shipments.length} shipments`)

  // Create a sample invoice
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - 7)
  const weekEnd = new Date(today)

  const recentShipments = shipments.slice(0, 7)
  const subtotal = recentShipments.reduce((sum, s) => sum + s.shippingCost, 0)
  const taxRate = 0.08
  const taxAmount = subtotal * taxRate
  const totalAmount = subtotal + taxAmount

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-000001',
      customerId: customer.id,
      issueDate: today,
      dueDate: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000),
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      status: 'SENT',
      subtotal,
      taxRate,
      taxAmount,
      totalAmount,
      lineItems: {
        create: [
          {
            description: `Shipping services for week of ${weekStart.toLocaleDateString()}`,
            quantity: recentShipments.length,
            unitPrice: subtotal / recentShipments.length,
            amount: subtotal,
          },
        ],
      },
    },
  })

  // Update shipments with invoice ID
  await prisma.shipment.updateMany({
    where: {
      id: { in: recentShipments.map(s => s.id) },
    },
    data: {
      invoiceId: invoice.id,
    },
  })

  console.log('Created invoice:', invoice.invoiceNumber)
  console.log('Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
