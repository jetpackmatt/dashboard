"use client"

import * as React from "react"
import { Upload, X, File, Image } from "lucide-react"
import { JetpackLoader } from "@/components/jetpack-loader"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface UploadedFile {
  name: string
  url: string
  path?: string  // Storage path for generating fresh signed URLs (optional for backwards compat)
  size: number
  type: string
}

interface FileUploadProps {
  value: UploadedFile[]
  onChange: (files: UploadedFile[]) => void
  maxFiles?: number
  maxSizeMb?: number
  accept?: string
  disabled?: boolean
  required?: boolean
  className?: string
  singleFile?: boolean  // When true, replaces drop zone with uploaded file
  // For shared budget across multiple upload fields:
  totalBudgetMb?: number    // Total MB budget across all upload fields
  usedBudgetBytes?: number  // Bytes already used by OTHER upload fields
}

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.ms-excel',                                              // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',    // .xlsx
  'text/csv',                                                              // .csv
  'application/msword',                                                    // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.xls', '.xlsx', '.csv', '.doc', '.docx']

export function FileUpload({
  value,
  onChange,
  maxFiles = 5,
  maxSizeMb = 10,
  accept = "image/*,.pdf",
  disabled = false,
  required = false,
  className,
  singleFile = false,
  totalBudgetMb,
  usedBudgetBytes = 0,
}: FileUploadProps) {
  // In single file mode, enforce maxFiles = 1
  const effectiveMaxFiles = singleFile ? 1 : maxFiles

  // Calculate remaining budget if using shared budget
  const currentFieldBytes = value.reduce((sum, f) => sum + f.size, 0)
  const totalUsedBytes = usedBudgetBytes + currentFieldBytes
  const remainingBudgetBytes = totalBudgetMb
    ? (totalBudgetMb * 1024 * 1024) - totalUsedBytes
    : null
  const [isDragging, setIsDragging] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragging(true)
    }
  }, [disabled])

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const validateFile = (file: File): string | null => {
    // Check file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    }

    // Check file size against per-file limit
    const sizeMb = file.size / (1024 * 1024)
    if (sizeMb > maxSizeMb) {
      return `File too large. Maximum size: ${maxSizeMb}MB`
    }

    // Check against shared budget if specified
    if (remainingBudgetBytes !== null && file.size > remainingBudgetBytes) {
      const remainingMb = (remainingBudgetBytes / (1024 * 1024)).toFixed(1)
      return `File exceeds remaining budget. Only ${remainingMb}MB left of ${totalBudgetMb}MB total.`
    }

    return null
  }

  const uploadFile = async (file: File): Promise<UploadedFile | null> => {
    // Validate
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return null
    }

    // Upload to Supabase Storage via API
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/upload/claim-attachment', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        let errorMessage = 'Upload failed'
        const rawText = await response.text()
        try {
          const errorData = JSON.parse(rawText)
          errorMessage = errorData.error || errorMessage
        } catch {
          // Server returned non-JSON (e.g. "Request Entity Too Large")
          if (response.status === 413 || rawText.toLowerCase().includes('entity too large')) {
            errorMessage = 'File is too large. Please try a smaller file.'
          } else if (rawText) {
            errorMessage = rawText
          }
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      return {
        name: file.name,
        url: data.url,
        path: data.path,  // Store path for generating fresh signed URLs later
        size: file.size,
        type: file.type,
      }
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
      return null
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    if (disabled) return

    setError(null)
    const fileArray = Array.from(files)

    // Check if we'd exceed max files
    if (value.length + fileArray.length > effectiveMaxFiles) {
      setError(`Maximum ${effectiveMaxFiles} file${effectiveMaxFiles > 1 ? 's' : ''} allowed`)
      return
    }

    setIsUploading(true)

    try {
      const uploadPromises = fileArray.map(uploadFile)
      const results = await Promise.all(uploadPromises)
      const successfulUploads = results.filter((r): r is UploadedFile => r !== null)

      if (successfulUploads.length > 0) {
        onChange([...value, ...successfulUploads])
      }
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (disabled) return

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFiles(files)
    }
  }, [disabled, value, effectiveMaxFiles]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFiles(files)
    }
    // Reset input value so the same file can be selected again
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  const handleRemove = (index: number) => {
    const newFiles = [...value]
    newFiles.splice(index, 1)
    onChange(newFiles)
  }

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) {
      return <Image className="h-4 w-4" />
    }
    return <File className="h-4 w-4" />
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Single file mode: show uploaded file instead of drop zone
  const hasSingleFileUploaded = singleFile && value.length > 0
  const showDropZone = !hasSingleFileUploaded

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={!singleFile}
        onChange={handleInputChange}
        disabled={disabled}
      />

      {/* Single file mode: show file in place of drop zone */}
      {hasSingleFileUploaded && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
          {getFileIcon(value[0].type)}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{value[0].name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(value[0].size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              handleRemove(0)
            }}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Remove</span>
          </Button>
        </div>
      )}

      {/* Drop zone - hidden in single file mode when file is uploaded */}
      {showDropZone && (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors",
            singleFile ? "p-4" : "p-6",  // Smaller padding for single file mode
            isDragging && "border-primary bg-primary/5",
            disabled && "opacity-50 cursor-not-allowed",
            !isDragging && !disabled && "border-muted-foreground/25 hover:border-muted-foreground/50"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && inputRef.current?.click()}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <JetpackLoader size={singleFile ? "md" : "lg"} />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <div className={cn("flex items-center gap-3", singleFile ? "flex-row justify-center" : "flex-col")}>
              <Upload className={cn("text-muted-foreground", singleFile ? "h-5 w-5" : "h-8 w-8")} />
              <div className={singleFile ? "" : "text-center"}>
                <p className="text-sm font-medium">
                  {singleFile ? "Drop file or click to browse" : "Drop files here or click to browse"}
                </p>
                {!singleFile && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Up to {maxSizeMb}MB per file ({effectiveMaxFiles} files max)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Required indicator */}
      {required && value.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          At least one file is required
        </p>
      )}

      {/* File list - only shown in multi-file mode */}
      {!singleFile && value.length > 0 && (
        <div className="space-y-2">
          {value.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
            >
              {getFileIcon(file.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemove(index)
                }}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Remove</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
