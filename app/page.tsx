import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Package, BarChart3, FileText, TrendingUp } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <nav className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package className="h-8 w-8 text-blue-600" />
            <span className="text-2xl font-bold text-gray-900">ShipTrack</span>
          </div>
          <div className="space-x-4">
            <Link href="/dashboard">
              <Button variant="outline">Dashboard</Button>
            </Link>
            <Link href="/dashboard">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Your Complete Shipping Solution
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Track shipments, generate invoices, and analyze your shipping data—all in one beautiful dashboard.
          </p>
          <Link href="/dashboard">
            <Button size="lg" className="text-lg px-8 py-6">
              Launch Dashboard
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <FileText className="h-12 w-12 text-blue-600 mb-4" />
              <CardTitle>Invoice Management</CardTitle>
              <CardDescription>
                Generate and manage weekly invoices automatically from your shipping data
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <Package className="h-12 w-12 text-blue-600 mb-4" />
              <CardTitle>Shipment Tracking</CardTitle>
              <CardDescription>
                Upload CSV files and track all your shipments in real-time
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <BarChart3 className="h-12 w-12 text-blue-600 mb-4" />
              <CardTitle>Analytics Dashboard</CardTitle>
              <CardDescription>
                Visualize shipping trends, costs, and performance metrics
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-2 hover:border-blue-300 transition-colors">
            <CardHeader>
              <TrendingUp className="h-12 w-12 text-blue-600 mb-4" />
              <CardTitle>Reporting</CardTitle>
              <CardDescription>
                Generate comprehensive reports for business insights
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card className="max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="text-center text-3xl">How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start space-x-4">
              <div className="bg-blue-100 rounded-full p-3 text-blue-600 font-bold">1</div>
              <div>
                <h3 className="font-semibold text-lg mb-2">Upload Shipping Data</h3>
                <p className="text-gray-600">
                  Simply upload your CSV files containing shipping activity data
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="bg-blue-100 rounded-full p-3 text-blue-600 font-bold">2</div>
              <div>
                <h3 className="font-semibold text-lg mb-2">Auto-Generate Invoices</h3>
                <p className="text-gray-600">
                  The system automatically creates weekly invoices based on your shipping records
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="bg-blue-100 rounded-full p-3 text-blue-600 font-bold">3</div>
              <div>
                <h3 className="font-semibold text-lg mb-2">View Analytics</h3>
                <p className="text-gray-600">
                  Access detailed analytics and reports to understand your shipping patterns
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t mt-16 py-8">
        <div className="container mx-auto px-4 text-center text-gray-600">
          <p>© 2025 ShipTrack. Built with Next.js, Prisma, and Radix UI.</p>
        </div>
      </footer>
    </div>
  )
}
