"use client"

import { SubmitClaimButton } from "./submit-claim-button"

/**
 * Global claim button wrapper for use in the dashboard layout.
 * Positioned fixed at the bottom left of the viewport.
 */
export function GlobalClaimButton() {
  return (
    <div className="fixed bottom-4 left-4 z-40 md:left-[calc(var(--sidebar-width)+1rem)]">
      <SubmitClaimButton />
    </div>
  )
}
