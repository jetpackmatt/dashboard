/**
 * Export Utility Library
 * Handles CSV and XLS (Excel) export for transaction tables
 */

import * as XLSX from 'xlsx'
import { TableConfig } from './table-config'

export type ExportFormat = 'csv' | 'xlsx'
export type ExportScope = 'current' | 'all'

export interface ExportOptions {
  format: ExportFormat
  scope: ExportScope
  filename: string
  // Table configuration for column headers
  tableConfig?: TableConfig
  // Optional custom column mapping (data key -> display header)
  columnMapping?: Record<string, string>
  // Columns to include in export (by id). If not specified, uses all visible columns
  columns?: string[]
}

/**
 * Format an ISO date string for export
 * Input: '2025-01-15T12:30:45.000Z' or '2025-01-15'
 * Output: 'Jan 15, 2025' (date-only) or 'Jan 15, 2025 12:30 PM' (with time)
 */
function formatDateForExport(dateStr: string): string {
  if (!dateStr) return ''

  // Check if it's a date-only string (YYYY-MM-DD)
  const isDateOnly = dateStr.length === 10 || !dateStr.includes('T')

  try {
    if (isDateOnly) {
      // Parse as date-only without timezone conversion
      const [year, month, day] = dateStr.split('T')[0].split('-')
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
    }

    // Full datetime - format with time
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  } catch {
    return dateStr
  }
}

/**
 * Check if a value looks like an ISO date string
 */
function isISODateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  // Match YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS patterns
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)
}

/**
 * Transform data for export based on column configuration
 */
function transformDataForExport<T extends Record<string, unknown>>(
  data: T[],
  config?: TableConfig,
  columnMapping?: Record<string, string>,
  columns?: string[]
): { headers: string[]; rows: unknown[][] } {
  if (!data || data.length === 0) {
    return { headers: [], rows: [] }
  }

  // Determine which columns to include
  let columnsToExport: string[]
  let headerMap: Record<string, string> = {}

  if (config) {
    // Use table config for column info
    const configColumns = config.columns
    columnsToExport = columns || configColumns.map(c => c.id)
    headerMap = configColumns.reduce((acc, col) => {
      acc[col.id] = col.header
      return acc
    }, {} as Record<string, string>)
  } else if (columnMapping) {
    // Use custom column mapping
    columnsToExport = columns || Object.keys(columnMapping)
    headerMap = columnMapping
  } else {
    // Fallback: use keys from first data item
    columnsToExport = columns || Object.keys(data[0])
    headerMap = columnsToExport.reduce((acc, key) => {
      // Convert camelCase to Title Case
      acc[key] = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()
      return acc
    }, {} as Record<string, string>)
  }

  // Filter to only columns that exist
  columnsToExport = columnsToExport.filter(col => headerMap[col])

  const headers = columnsToExport.map(col => headerMap[col])
  const rows = data.map(item =>
    columnsToExport.map(col => {
      const value = item[col]
      // Format values for export
      if (value === null || value === undefined) return ''
      if (value instanceof Date) return formatDateForExport(value.toISOString())
      if (typeof value === 'boolean') return value ? 'Yes' : 'No'
      // Format ISO date strings
      if (isISODateString(value)) return formatDateForExport(value)
      // Format age/transit time (days) - show as "X.X days"
      if ((col === 'age' || col === 'transitTimeDays') && typeof value === 'number') {
        return `${value.toFixed(1)} days`
      }
      // Format currency values
      if (col === 'charge' || col === 'creditAmount') {
        const numVal = typeof value === 'number' ? value : parseFloat(String(value))
        if (!isNaN(numVal)) return `$${numVal.toFixed(2)}`
      }
      return value
    })
  )

  return { headers, rows }
}

/**
 * Generate CSV string from data
 */
function generateCSV(headers: string[], rows: unknown[][]): string {
  const escapeCell = (cell: unknown): string => {
    const str = String(cell ?? '')
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const headerRow = headers.map(escapeCell).join(',')
  const dataRows = rows.map(row => row.map(escapeCell).join(','))

  return [headerRow, ...dataRows].join('\n')
}

/**
 * Generate XLSX workbook from data
 */
function generateXLSX(headers: string[], rows: unknown[][], sheetName: string = 'Data'): Blob {
  // Create worksheet data with headers
  const wsData = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Auto-size columns based on content
  const colWidths = headers.map((header, i) => {
    const maxLength = Math.max(
      header.length,
      ...rows.map(row => String(row[i] ?? '').length)
    )
    return { wch: Math.min(maxLength + 2, 50) } // Cap at 50 chars
  })
  ws['!cols'] = colWidths

  // Create workbook
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  // Generate blob
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * Trigger browser download of a file
 */
function downloadFile(content: string | Blob, filename: string, mimeType: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Export data to CSV or XLSX format
 */
export function exportData<T extends Record<string, unknown>>(
  data: T[],
  options: ExportOptions
): void {
  const { format, filename, tableConfig, columnMapping, columns } = options
  const { headers, rows } = transformDataForExport(data, tableConfig, columnMapping, columns)

  if (headers.length === 0) {
    console.warn('No data to export')
    return
  }

  const timestamp = new Date().toISOString().split('T')[0]
  const fullFilename = `${filename}_${timestamp}`

  if (format === 'csv') {
    const csv = generateCSV(headers, rows)
    downloadFile(csv, `${fullFilename}.csv`, 'text/csv;charset=utf-8;')
  } else {
    const xlsx = generateXLSX(headers, rows, filename)
    downloadFile(xlsx, `${fullFilename}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }
}

/**
 * Build API URL with query parameters for fetching all data
 * (used when exporting all pages)
 */
export function buildExportApiUrl(
  baseUrl: string,
  params: Record<string, string | number | null | undefined>
): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      searchParams.set(key, String(value))
    }
  }
  const queryString = searchParams.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}
