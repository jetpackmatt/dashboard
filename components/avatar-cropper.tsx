'use client'

import * as React from 'react'
import Cropper from 'react-easy-crop'
import type { Area, Point } from 'react-easy-crop'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { JetpackLoader } from '@/components/jetpack-loader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'

interface AvatarCropperProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageSrc: string
  onCropComplete: (croppedBlob: Blob) => void
}

// Helper to create image element from URL
function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })
}

// Helper to get cropped image as blob
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area
): Promise<Blob> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('No 2d context')
  }

  // Set canvas size to desired crop size (output at 256x256 for avatar)
  const outputSize = 256
  canvas.width = outputSize
  canvas.height = outputSize

  // Draw the cropped image
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize
  )

  // Convert canvas to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Canvas is empty'))
        }
      },
      'image/jpeg',
      0.9
    )
  })
}

export function AvatarCropper({
  open,
  onOpenChange,
  imageSrc,
  onCropComplete,
}: AvatarCropperProps) {
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null)
  const [isProcessing, setIsProcessing] = React.useState(false)

  const onCropChange = (newCrop: Point) => {
    setCrop(newCrop)
  }

  const onZoomChange = (newZoom: number) => {
    setZoom(newZoom)
  }

  const onCropAreaComplete = React.useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels)
    },
    []
  )

  const handleSave = async () => {
    if (!croppedAreaPixels) return

    setIsProcessing(true)
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels)
      onCropComplete(croppedBlob)
      onOpenChange(false)
    } catch (error) {
      console.error('Error cropping image:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancel = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    onOpenChange(false)
  }

  // Reset state when dialog opens with new image
  React.useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 })
      setZoom(1)
    }
  }, [open, imageSrc])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Profile Photo</DialogTitle>
          <DialogDescription>
            Drag to reposition and use the slider to zoom in or out.
          </DialogDescription>
        </DialogHeader>

        <div className="relative w-full aspect-square bg-muted rounded-lg overflow-hidden">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={onCropAreaComplete}
          />
        </div>

        <div className="flex items-center gap-3 px-2">
          <ZoomOut className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Slider
            value={[zoom]}
            min={1}
            max={3}
            step={0.1}
            onValueChange={([value]) => setZoom(value)}
            className="flex-1"
          />
          <ZoomIn className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel} disabled={isProcessing}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isProcessing}>
            {isProcessing ? (
              <>
                <JetpackLoader size="sm" className="mr-2" />
                Processing...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
