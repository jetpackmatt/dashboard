'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react'

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; count?: number } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setResult(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      
      if (response.ok) {
        setResult({
          success: true,
          message: data.message,
          count: data.count,
        })
        setFile(null)
      } else {
        setResult({
          success: false,
          message: data.error || 'Upload failed',
        })
      }
    } catch (error) {
      setResult({
        success: false,
        message: 'An error occurred during upload',
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Upload Shipping Data</h1>
        <p className="text-gray-600 mt-2">Import your shipping activity from CSV files</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload CSV File</CardTitle>
            <CardDescription>
              Upload a CSV file containing your shipping data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <Label htmlFor="file-upload" className="cursor-pointer">
                  <span className="text-blue-600 hover:text-blue-700 font-medium">
                    Choose a file
                  </span>
                  <span className="text-gray-600"> or drag and drop</span>
                </Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <p className="text-xs text-gray-500 mt-2">CSV files only</p>
              </div>
            </div>

            {file && (
              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center">
                  <FileText className="h-5 w-5 text-blue-600 mr-2" />
                  <span className="text-sm font-medium">{file.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFile(null)}
                >
                  Remove
                </Button>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? 'Uploading...' : 'Upload and Process'}
            </Button>

            {result && (
              <div className={`p-4 rounded-lg flex items-start ${
                result.success ? 'bg-green-50' : 'bg-red-50'
              }`}>
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 mr-2 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 mr-2 mt-0.5" />
                )}
                <div>
                  <p className={`font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                    {result.message}
                  </p>
                  {result.count && (
                    <p className="text-sm text-green-700 mt-1">
                      {result.count} shipments imported successfully
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CSV Format Requirements</CardTitle>
            <CardDescription>Your CSV file should include the following columns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-sm">
                <h4 className="font-semibold mb-2">Required Columns:</h4>
                <ul className="space-y-1 text-gray-600">
                  <li>• <code className="bg-gray-100 px-1 rounded">tracking_number</code> - Unique tracking ID</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">shipment_date</code> - Date of shipment (YYYY-MM-DD)</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">origin</code> - Origin location</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">destination</code> - Destination location</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">weight</code> - Package weight in lbs</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">service_type</code> - Shipping service type</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">shipping_cost</code> - Cost of shipment</li>
                </ul>
              </div>

              <div className="text-sm">
                <h4 className="font-semibold mb-2">Optional Columns:</h4>
                <ul className="space-y-1 text-gray-600">
                  <li>• <code className="bg-gray-100 px-1 rounded">carrier</code> - Carrier name (UPS, FedEx, etc.)</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">dimensions</code> - Package dimensions</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">package_type</code> - Type of package</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">status</code> - Delivery status</li>
                  <li>• <code className="bg-gray-100 px-1 rounded">delivered_at</code> - Delivery date (YYYY-MM-DD)</li>
                </ul>
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded">
                <p className="text-xs text-blue-800">
                  <strong>Tip:</strong> Download our sample CSV template to ensure your data is formatted correctly.
                </p>
                <Button variant="outline" size="sm" className="mt-2">
                  Download Sample Template
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
