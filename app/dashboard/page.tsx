import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Package, DollarSign, TrendingUp, FileText } from 'lucide-react'
import { prisma } from '@/lib/db'
import { formatCurrency } from '@/lib/utils'

async function getDashboardStats() {
  const [
    totalShipments,
    totalInvoices,
    pendingInvoices,
    recentShipments,
    recentInvoices,
  ] = await Promise.all([
    prisma.shipment.count(),
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: 'PENDING' } }),
    prisma.shipment.findMany({
      take: 5,
      orderBy: { shipmentDate: 'desc' },
      include: { customer: true }
    }),
    prisma.invoice.findMany({
      take: 5,
      orderBy: { issueDate: 'desc' },
      include: { customer: true }
    }),
  ])

  const totalRevenue = await prisma.invoice.aggregate({
    _sum: { totalAmount: true },
    where: { status: { not: 'CANCELLED' } }
  })

  return {
    totalShipments,
    totalInvoices,
    pendingInvoices,
    totalRevenue: totalRevenue._sum.totalAmount || 0,
    recentShipments,
    recentInvoices,
  }
}

export default async function DashboardPage() {
  const stats = await getDashboardStats()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome back! Here's your shipping overview.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Shipments</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalShipments}</div>
            <p className="text-xs text-muted-foreground">All time shipments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">From all invoices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalInvoices}</div>
            <p className="text-xs text-muted-foreground">{stats.pendingInvoices} pending</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Growth</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+12.5%</div>
            <p className="text-xs text-muted-foreground">vs last month</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Shipments</CardTitle>
            <CardDescription>Your latest shipping activity</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentShipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shipments yet. Upload your first CSV to get started!</p>
            ) : (
              <div className="space-y-4">
                {stats.recentShipments.map((shipment) => (
                  <div key={shipment.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{shipment.trackingNumber}</p>
                      <p className="text-sm text-gray-600">{shipment.destination}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(shipment.shippingCost)}</p>
                      <p className="text-xs text-gray-500">{shipment.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>Latest invoices generated</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet. Upload shipping data to generate invoices!</p>
            ) : (
              <div className="space-y-4">
                {stats.recentInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{invoice.invoiceNumber}</p>
                      <p className="text-sm text-gray-600">{invoice.customer.companyName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(invoice.totalAmount)}</p>
                      <p className="text-xs text-gray-500">{invoice.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
