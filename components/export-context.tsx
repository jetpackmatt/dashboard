"use client"

import * as React from "react"

// ---------------------------------------------------------------------------
// Module-level store — lives outside React, survives navigation / remounts
// ---------------------------------------------------------------------------

interface ExportProgress {
  phase: string
  fetched: number
  total: number
  source: string
}

interface ExportState {
  progress: ExportProgress | null
  isExporting: boolean
}

let state: ExportState = { progress: null, isExporting: false }
const listeners = new Set<() => void>()

function getSnapshot(): ExportState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function setState(patch: Partial<ExportState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

// Active abort controller (module-level, not a React ref)
let activeAbort: AbortController | null = null
let safetyTimer: ReturnType<typeof setTimeout> | null = null

// Max time before we assume the export is stuck (6 minutes)
const EXPORT_TIMEOUT_MS = 6 * 60 * 1000

function cancelExport() {
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }
  if (safetyTimer) {
    clearTimeout(safetyTimer)
    safetyTimer = null
  }
  setState({ progress: null, isExporting: false })
}

// ---------------------------------------------------------------------------
// startStreamingExport — plain function, no React dependency
// ---------------------------------------------------------------------------

export interface StreamingExportOptions {
  url: string
  body: Record<string, unknown>
  source: string
  totalCount?: number
  onSuccess?: () => void
  onError?: (error: Error) => void
}

function startStreamingExport(options: StreamingExportOptions) {
  const { url, body, source, totalCount = 0, onSuccess, onError } = options

  // Don't start if already running
  if (state.isExporting) return

  setState({
    isExporting: true,
    progress: { phase: 'Starting export...', fetched: 0, total: totalCount, source },
  })

  const controller = new AbortController()
  activeAbort = controller

  // Safety timeout — auto-cancel if export hangs for 6 minutes
  safetyTimer = setTimeout(() => {
    console.warn('Export timed out after 6 minutes — cancelling')
    cancelExport()
  }, EXPORT_TIMEOUT_MS)

  // Detached async — completely independent of React lifecycle
  ;(async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.body) {
        throw new Error('Export failed: no response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line)

          if (event.type === 'progress') {
            const phaseLabel =
              event.phase === 'shipments' ? 'Fetching records for export' :
              event.phase === 'details' ? 'Finalizing export' : 'Generating File'
            const serverTotal = event.total || totalCount
            setState({
              progress: { phase: phaseLabel, fetched: event.fetched, total: serverTotal, source },
            })
          } else if (event.type === 'file') {
            // Decode base64 and trigger browser download
            const binaryStr = atob(event.data)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            const blob = new Blob([bytes], { type: event.contentType })
            const downloadUrl = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = downloadUrl
            link.download = event.filename
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(downloadUrl)
            onSuccess?.()
          } else if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const error = err instanceof Error ? err : new Error('Export failed')
      console.error('Streaming export error:', error)
      onError?.(error)
    } finally {
      if (safetyTimer) {
        clearTimeout(safetyTimer)
        safetyTimer = null
      }
      setState({ progress: null, isExporting: false })
      activeAbort = null
    }
  })()
}

// ---------------------------------------------------------------------------
// startClientExport — client-side paginated export with same progress bar
// ---------------------------------------------------------------------------

export interface ClientExportOptions {
  apiUrl: string
  params: URLSearchParams
  source: string
  totalCount?: number
  exportFn: (data: Record<string, unknown>[]) => void
  onSuccess?: () => void
  onError?: (error: Error) => void
}

function startClientExport(options: ClientExportOptions) {
  const { apiUrl, params, source, totalCount = 0, exportFn, onSuccess, onError } = options

  if (state.isExporting) return

  setState({
    isExporting: true,
    progress: { phase: 'Starting export...', fetched: 0, total: totalCount, source },
  })

  const controller = new AbortController()
  activeAbort = controller

  safetyTimer = setTimeout(() => {
    console.warn('Export timed out after 6 minutes — cancelling')
    cancelExport()
  }, EXPORT_TIMEOUT_MS)

  // Detached async — survives navigation, same as streaming version
  ;(async () => {
    try {
      // Dynamic import to avoid circular dependency
      const { fetchAllForExport } = await import('@/lib/export')

      const data = await fetchAllForExport<Record<string, unknown>>(apiUrl, params, {
        onProgress: (fetched, total) => {
          if (controller.signal.aborted) return
          setState({
            progress: { phase: 'Fetching records for export', fetched, total, source },
          })
        },
      })

      if (controller.signal.aborted) return

      setState({
        progress: { phase: 'Generating File', fetched: data.length, total: data.length, source },
      })

      exportFn(data)
      onSuccess?.()
    } catch (err) {
      if (controller.signal.aborted) return
      const error = err instanceof Error ? err : new Error('Export failed')
      console.error('Client export error:', error)
      onError?.(error)
    } finally {
      if (safetyTimer) {
        clearTimeout(safetyTimer)
        safetyTimer = null
      }
      setState({ progress: null, isExporting: false })
      activeAbort = null
    }
  })()
}

// ---------------------------------------------------------------------------
// React hook — subscribes to the module-level store
// ---------------------------------------------------------------------------

interface ExportContextValue {
  exportProgress: ExportProgress | null
  isExporting: boolean
  startStreamingExport: (options: StreamingExportOptions) => void
  startClientExport: (options: ClientExportOptions) => void
  cancelExport: () => void
}

const ExportContext = React.createContext<ExportContextValue>({
  exportProgress: null,
  isExporting: false,
  startStreamingExport,
  startClientExport,
  cancelExport,
})

export function useExport() {
  return React.useContext(ExportContext)
}

// ---------------------------------------------------------------------------
// Provider — renders the floating progress bar
// ---------------------------------------------------------------------------

export function ExportProvider({ children }: { children: React.ReactNode }) {
  const currentState = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const value = React.useMemo<ExportContextValue>(
    () => ({
      exportProgress: currentState.progress,
      isExporting: currentState.isExporting,
      startStreamingExport,
      startClientExport,
      cancelExport,
    }),
    [currentState]
  )

  const progress = currentState.progress

  return (
    <ExportContext.Provider value={value}>
      {children}
      {/* Floating progress bar — rendered by provider so it persists */}
      {progress && (
        <div className="fixed bottom-6 right-6 z-[100] w-80 rounded-lg border bg-background p-4 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{progress.phase}</span>
            <div className="flex items-center gap-2">
              {progress.total > 0 && progress.phase === 'Fetching records for export' && (
                <span className="text-xs text-muted-foreground">
                  {Math.min(100, Math.round((progress.fetched / progress.total) * 100))}%
                </span>
              )}
              <button
                onClick={cancelExport}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Cancel export"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            {progress.phase === 'Fetching records for export' && progress.total > 0 ? (
              <div
                className="h-2 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.min(100, (progress.fetched / progress.total) * 100)}%` }}
              />
            ) : (
              <div className="h-2 w-full animate-pulse rounded-full bg-primary/60" />
            )}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {progress.fetched > 0
                ? `${progress.fetched.toLocaleString()}${progress.total > 0 ? ` / ${progress.total.toLocaleString()}` : ''} records`
                : 'Preparing...'}
            </span>
            <span className="text-xs text-muted-foreground">{progress.source}</span>
          </div>
        </div>
      )}
    </ExportContext.Provider>
  )
}
