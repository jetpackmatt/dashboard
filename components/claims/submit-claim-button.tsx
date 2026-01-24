"use client"

import * as React from "react"
import { FileWarning } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ClaimSubmissionDialog } from "./claim-submission-dialog"
import { ClaimType, getClaimTypeLabel } from "@/lib/claims/eligibility"
import { useClient } from "@/components/client-context"

export function SubmitClaimButton() {
  const { selectedClientId } = useClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [selectedClaimType, setSelectedClaimType] = React.useState<ClaimType | undefined>()

  // Don't render if no client is selected
  if (!selectedClientId) {
    return null
  }

  const handleClaimTypeSelect = (claimType: ClaimType) => {
    setSelectedClaimType(claimType)
    setDialogOpen(true)
  }

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      // Reset selected claim type when dialog closes
      setSelectedClaimType(undefined)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <FileWarning className="h-4 w-4" />
            Submit a Claim
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-48">
          <DropdownMenuItem onClick={() => handleClaimTypeSelect("lostInTransit")}>
            {getClaimTypeLabel("lostInTransit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleClaimTypeSelect("damage")}>
            {getClaimTypeLabel("damage")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleClaimTypeSelect("incorrectItems")}>
            {getClaimTypeLabel("incorrectItems")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleClaimTypeSelect("incorrectQuantity")}>
            {getClaimTypeLabel("incorrectQuantity")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ClaimSubmissionDialog
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        preselectedClaimType={selectedClaimType}
      />
    </>
  )
}
