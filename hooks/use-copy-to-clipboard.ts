"use client"

import * as React from "react"
import { toast } from "sonner"

/**
 * Copy text to clipboard with a toast notification.
 * Use this directly in event handlers that don't need "copied" visual state.
 */
export function copyToClipboard(text: string, message?: string) {
  navigator.clipboard.writeText(text)
  if (message) {
    toast.success(message)
  }
}

/**
 * Hook for clipboard copy with "copied" visual state (icon swap, etc.).
 * Returns { copied, copy } — `copied` resets to false after `timeout` ms.
 */
export function useCopyToClipboard(timeout = 2000) {
  const [copied, setCopied] = React.useState(false)

  const copy = React.useCallback((text: string, message?: string) => {
    copyToClipboard(text, message)
    setCopied(true)
    setTimeout(() => setCopied(false), timeout)
  }, [timeout])

  return { copied, copy }
}
