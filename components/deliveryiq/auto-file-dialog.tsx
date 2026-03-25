'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

interface EligibleShipment {
  shipmentId: string
  trackingNumber: string
}

interface FilingResult {
  shipmentId: string
  trackingNumber: string
  success: boolean
  reason?: string
  ticketNumber?: number
}

interface AutoFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eligibleShipments: EligibleShipment[]
  clientId: string
  onComplete: () => void
}

type Stage = 'confirm' | 'filing' | 'complete'

export function AutoFileDialog({
  open,
  onOpenChange,
  eligibleShipments,
  clientId,
  onComplete,
}: AutoFileDialogProps) {
  const [stage, setStage] = React.useState<Stage>('confirm')
  const [results, setResults] = React.useState<FilingResult[]>([])
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [isRunning, setIsRunning] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const total = eligibleShipments.length
  const filed = results.filter(r => r.success).length
  const skipped = results.filter(r => !r.success).length
  const progress = total > 0 ? Math.round((results.length / total) * 100) : 0

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setStage('confirm')
      setResults([])
      setCurrentIndex(0)
      setIsRunning(false)
    }
  }, [open])

  // Auto-scroll log to bottom
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [results])

  const handleStartFiling = async () => {
    setStage('filing')
    setIsRunning(true)

    let filedCount = 0
    let skippedCount = 0

    for (let i = 0; i < eligibleShipments.length; i++) {
      const shipment = eligibleShipments[i]
      setCurrentIndex(i)

      try {
        const res = await fetch('/api/data/monitoring/auto-file-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shipmentId: shipment.shipmentId,
            clientId,
          }),
        })

        const data = await res.json()

        if (data.success) filedCount++
        else skippedCount++

        setResults(prev => [...prev, {
          shipmentId: shipment.shipmentId,
          trackingNumber: shipment.trackingNumber,
          success: data.success,
          reason: data.reason,
          ticketNumber: data.ticketNumber,
        }])
      } catch {
        skippedCount++
        setResults(prev => [...prev, {
          shipmentId: shipment.shipmentId,
          trackingNumber: shipment.trackingNumber,
          success: false,
          reason: 'Network error',
        }])
      }
    }

    setIsRunning(false)
    setStage('complete')

    // Slack summary notification (fire-and-forget)
    fetch('/api/data/monitoring/auto-file-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        filed: filedCount,
        skipped: skippedCount,
        total,
      }),
    }).catch(() => {})
  }

  const handleClose = () => {
    if (isRunning) return // Don't allow closing while filing
    onOpenChange(false)
    if (stage === 'complete') {
      onComplete()
    }
  }

  // Truncate tracking number for display
  const truncateTracking = (tn: string) =>
    tn.length > 20 ? tn.slice(0, 17) + '...' : tn

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            Enable Automatic Lost-in-Transit Claim Filing
          </DialogTitle>
          {stage === 'confirm' && (
            <DialogDescription className="text-[13px] leading-relaxed pt-2">
              Auto-File will automatically file lost-in-transit claims with the carrier,
              bypassing the need for you to monitor and manually file. Each claim will be
              assigned a Jetpack Care ticket so you can follow progress. As with all claims,
              approval is not guaranteed. Upon proceeding, auto-file will immediately file
              claims for <strong>{total} eligible shipment{total === 1 ? '' : 's'}</strong> and
              automatically file new claims daily. You can turn this off at any time.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Filing Progress */}
        {(stage === 'filing' || stage === 'complete') && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                <span>
                  {stage === 'filing'
                    ? `Filing claim ${currentIndex + 1} of ${total}...`
                    : `Complete — ${filed} filed, ${skipped} skipped`
                  }
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Scrollable results log */}
            <ScrollArea className="h-[240px] rounded-md border">
              <div ref={scrollRef} className="p-3 space-y-1.5 text-[12px] font-mono">
                {results.map((result, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {result.success ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                    )}
                    <span className={result.success ? 'text-foreground' : 'text-muted-foreground'}>
                      {truncateTracking(result.trackingNumber)}
                      {' — '}
                      {result.success
                        ? `Claim filed (#${result.ticketNumber})`
                        : result.reason || 'Failed'
                      }
                    </span>
                  </div>
                ))}
                {stage === 'filing' && isRunning && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span>
                      {truncateTracking(eligibleShipments[currentIndex]?.trackingNumber || '')}
                      {' — Verifying...'}
                    </span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          {stage === 'confirm' && (
            <>
              <Button variant="outline" onClick={handleClose} className="text-[13px]">
                Cancel
              </Button>
              <Button onClick={handleStartFiling} className="text-[13px]">
                Enable &amp; File {total} Claim{total === 1 ? '' : 's'}
              </Button>
            </>
          )}
          {stage === 'filing' && (
            <Button disabled className="text-[13px]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Filing claims...
            </Button>
          )}
          {stage === 'complete' && (
            <Button onClick={handleClose} className="text-[13px]">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
