"use client"

import * as React from "react"
import { Upload, X, File, Image, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface UploadedFile {
  name: string
  url: string
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
}

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']

export function FileUpload({
  value,
  onChange,
  maxFiles = 5,
  maxSizeMb = 10,
  accept = "image/*,.pdf",
  disabled = false,
  required = false,
  className,
}: FileUploadProps) {
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

    // Check file size
    const sizeMb = file.size / (1024 * 1024)
    if (sizeMb > maxSizeMb) {
      return `File too large. Maximum size: ${maxSizeMb}MB`
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
        const errorData = await response.json()
        throw new Error(errorData.error || 'Upload failed')
      }

      const data = await response.json()
      return {
        name: file.name,
        url: data.url,
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
    if (value.length + fileArray.length > maxFiles) {
      setError(`Maximum ${maxFiles} files allowed`)
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
  }, [disabled, value, maxFiles]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className={cn("space-y-3", className)}>
      {/* Drop zone */}
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          isDragging && "border-primary bg-primary/5",
          disabled && "opacity-50 cursor-not-allowed",
          !isDragging && !disabled && "border-muted-foreground/25 hover:border-muted-foreground/50"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple
          onChange={handleInputChange}
          disabled={disabled}
        />

        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Images and PDFs up to {maxSizeMb}MB ({maxFiles} files max)
              </p>
            </div>
          </div>
        )}
      </div>

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

      {/* File list */}
      {value.length > 0 && (
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
