"use client"

import * as React from "react"
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Package } from "lucide-react"
import { JetpackLoader } from "@/components/jetpack-loader"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FileUpload } from "./file-upload"
// Note: Client ID comes from shipment data (shipmentSummary.clientId), not client context
import {
  ClaimType,
  ClaimEligibilityResult,
  getClaimTypeLabel,
  claimTypeToIssueType,
} from "@/lib/claims/eligibility"
import { VerifyLostInTransitResponse } from "@/app/api/data/shipments/[id]/verify-lost-in-transit/route"
import { cn } from "@/lib/utils"

type ReshipmentOption = "Please reship for me" | "I've already reshipped" | "Don't reship"
type CompensationOption = "Credit me the item's manufacturing cost" | "Create a return label for me"

interface UploadedFile {
  name: string
  url: string
  path?: string  // Storage path for generating fresh signed URLs
  size: number
  type: string
}

// Structured attachments for documentation step
interface DocumentationAttachments {
  photo: UploadedFile[]          // Required for Damage, Pick Error, Short Ship
  customerComplaint: UploadedFile[]  // Required for Damage, Pick Error, Short Ship
  otherDocs: UploadedFile[]      // Optional
}

interface ClaimFormData {
  shipmentId: string
  claimType: ClaimType | null
  description: string
  reshipmentStatus: ReshipmentOption | null
  reshipmentId: string
  compensationRequest: CompensationOption | null
  attachments: DocumentationAttachments
}

interface ShipmentSummary {
  shipmentId: string
  clientId: string  // Needed for claim submission
  orderId: string
  trackingId: string
  carrier: string
  status: string
  customer: string
  labelCreated: string
}

interface ClaimSubmissionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Pre-filled shipment data (when opened from shipment drawer)
  shipmentId?: string
  preselectedClaimType?: ClaimType
  onSuccess?: (ticketNumber: number) => void
}

// All possible steps - actual steps shown depend on claim type
const ALL_STEPS = [
  { id: "shipment", title: "Shipment" },
  { id: "issue", title: "Issue Type" },
  { id: "verification", title: "Verification" }, // Lost in Transit only
  { id: "description", title: "Description" },
  { id: "reshipping", title: "Reshipping" },
  { id: "compensation", title: "Compensation" },
  { id: "documentation", title: "Documentation" },
]

// Step flows per claim type (after shipment and issue steps)
// Lost in Transit: verification → description → submit
// Damage: description → documentation → submit
// Incorrect Items: description → reshipping → compensation → documentation → submit
// Incorrect Qty: description → reshipping → documentation → submit

export function ClaimSubmissionDialog({
  open,
  onOpenChange,
  shipmentId: prefillShipmentId,
  preselectedClaimType,
  onSuccess,
}: ClaimSubmissionDialogProps) {
  const [currentStep, setCurrentStep] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = React.useState(false)
  const [ticketNumber, setTicketNumber] = React.useState<number | null>(null)

  // Form data
  const [formData, setFormData] = React.useState<ClaimFormData>({
    shipmentId: prefillShipmentId || "",
    claimType: preselectedClaimType || null,
    description: "",
    reshipmentStatus: null,
    reshipmentId: "",
    compensationRequest: null,
    attachments: {
      photo: [],
      customerComplaint: [],
      otherDocs: [],
    },
  })

  // Shipment data from lookup
  const [shipmentSummary, setShipmentSummary] = React.useState<ShipmentSummary | null>(null)
  const [eligibility, setEligibility] = React.useState<ClaimEligibilityResult | null>(null)

  // Lost in Transit verification state
  const [isVerifyingLIT, setIsVerifyingLIT] = React.useState(false)
  const [litVerification, setLitVerification] = React.useState<VerifyLostInTransitResponse | null>(null)

  // Reshipment ID validation state
  const [isValidatingReshipment, setIsValidatingReshipment] = React.useState(false)
  const [reshipmentValid, setReshipmentValid] = React.useState(false)
  const [reshipmentError, setReshipmentError] = React.useState<string | null>(null)

  // Auto-advance when Lost in Transit verification completes successfully
  React.useEffect(() => {
    if (litVerification?.eligible) {
      const applicableSteps = getApplicableSteps()
      const currentStepId = applicableSteps[currentStep]?.id

      // Only auto-advance if we're on the verification step
      if (currentStepId === "verification") {
        // Brief delay to show success state before advancing
        const timer = setTimeout(() => {
          setCurrentStep(prev => prev + 1)
        }, 1500)
        return () => clearTimeout(timer)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litVerification?.eligible, currentStep])

  // Reset form when dialog opens/closes
  React.useEffect(() => {
    if (open) {
      // Determine starting step based on what's prefilled:
      // - No prefill: start at step 0 (shipment selection)
      // - Prefill shipment only: start at step 1 (issue type selection)
      // - Prefill shipment AND Lost in Transit: start at step 2 (verification)
      // - Prefill shipment AND other claim type: start at step 2 (description, since no verification)
      // Note: Step indices are relative to the applicable steps, not the full STEPS array
      let startStep = 0
      if (prefillShipmentId) {
        if (preselectedClaimType) {
          // For LIT: go to verification step (index 2 in applicable steps)
          // For others: go to description step (index 2 in applicable steps, since verification is filtered out)
          startStep = 2
        } else {
          startStep = 1
        }
      }
      setCurrentStep(startStep)
      setFormData({
        shipmentId: prefillShipmentId || "",
        claimType: preselectedClaimType || null,
        description: "",
        reshipmentStatus: null,
        reshipmentId: "",
        compensationRequest: null,
        attachments: {
          photo: [],
          customerComplaint: [],
          otherDocs: [],
        },
      })
      setShipmentSummary(null)
      setEligibility(null)
      setError(null)
      setSubmitSuccess(false)
      setTicketNumber(null)
      setIsVerifyingLIT(false)
      setLitVerification(null)
      setReshipmentValid(false)
      setReshipmentError(null)
      setIsValidatingReshipment(false)

      // If we have a pre-filled shipment, fetch its data
      // If also preselecting Lost in Transit, trigger verification automatically
      if (prefillShipmentId) {
        const shouldTriggerLITVerification = preselectedClaimType === "lostInTransit"
        fetchShipmentData(prefillShipmentId, shouldTriggerLITVerification)
      }
    }
  }, [open, prefillShipmentId, preselectedClaimType])

  // Fetch shipment data and eligibility
  // If triggerLITVerification is true, also trigger Lost in Transit verification after fetching
  const fetchShipmentData = async (shipmentId: string, triggerLITVerification = false) => {
    setIsLoading(true)
    setError(null)

    try {
      // Fetch both shipment details and eligibility in parallel
      const [shipmentRes, eligibilityRes] = await Promise.all([
        fetch(`/api/data/shipments/${shipmentId}`),
        fetch(`/api/data/shipments/${shipmentId}/claim-eligibility`),
      ])

      if (!shipmentRes.ok) {
        if (shipmentRes.status === 404) {
          throw new Error("Shipment not found")
        }
        if (shipmentRes.status === 401) {
          throw new Error("Not authenticated - please log in again")
        }
        if (shipmentRes.status === 403) {
          throw new Error("You don't have access to this shipment")
        }
        // Try to get more details from the response
        let errorMessage = `Failed to load shipment (${shipmentRes.status})`
        try {
          const errorData = await shipmentRes.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          // JSON parsing failed, use default message
        }
        throw new Error(errorMessage)
      }

      const shipmentData = await shipmentRes.json()
      const eligibilityData = eligibilityRes.ok ? await eligibilityRes.json() : null

      setShipmentSummary({
        shipmentId: shipmentData.shipmentId,
        clientId: shipmentData.clientId,
        orderId: shipmentData.orderId,
        trackingId: shipmentData.trackingId || "—",
        carrier: shipmentData.shipping?.carrier || "—",
        status: shipmentData.status,
        customer: shipmentData.customer?.name || "—",
        labelCreated: shipmentData.dates?.labeled
          ? new Date(shipmentData.dates.labeled).toLocaleDateString()
          : "—",
      })

      if (eligibilityData) {
        setEligibility(eligibilityData)

        // If this is a preselected Lost in Transit claim, trigger verification automatically
        if (triggerLITVerification && eligibilityData.eligibility?.lostInTransit?.requiresVerification) {
          // Don't await - let it run in parallel while user sees the description form
          verifyLostInTransit(shipmentId)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shipment")
    } finally {
      setIsLoading(false)
    }
  }

  // Handle advancing from shipment step (fetches data then advances)
  const handleShipmentStepNext = async () => {
    if (!formData.shipmentId.trim()) {
      setError("Please enter a shipment ID")
      return
    }
    setIsLoading(true)
    setError(null)

    try {
      // Fetch both shipment details and eligibility in parallel
      const [shipmentRes, eligibilityRes] = await Promise.all([
        fetch(`/api/data/shipments/${formData.shipmentId.trim()}`),
        fetch(`/api/data/shipments/${formData.shipmentId.trim()}/claim-eligibility`),
      ])

      if (!shipmentRes.ok) {
        if (shipmentRes.status === 404) {
          throw new Error("Shipment not found")
        }
        if (shipmentRes.status === 401) {
          throw new Error("Not authenticated - please log in again")
        }
        if (shipmentRes.status === 403) {
          throw new Error("You don't have access to this shipment")
        }
        let errorMessage = `Failed to load shipment (${shipmentRes.status})`
        try {
          const errorData = await shipmentRes.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          // JSON parsing failed, use default message
        }
        throw new Error(errorMessage)
      }

      const shipmentData = await shipmentRes.json()
      const eligibilityData = eligibilityRes.ok ? await eligibilityRes.json() : null

      setShipmentSummary({
        shipmentId: shipmentData.shipmentId,
        clientId: shipmentData.clientId,
        orderId: shipmentData.orderId,
        trackingId: shipmentData.trackingId || "—",
        carrier: shipmentData.shipping?.carrier || "—",
        status: shipmentData.status,
        customer: shipmentData.customer?.name || "—",
        labelCreated: shipmentData.dates?.labeled
          ? new Date(shipmentData.dates.labeled).toLocaleDateString()
          : "—",
      })

      if (eligibilityData) {
        setEligibility(eligibilityData)
      }

      // Advance to next step (issue type selection)
      setCurrentStep(prev => prev + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shipment")
    } finally {
      setIsLoading(false)
    }
  }

  // Get applicable steps for current claim type
  const getApplicableSteps = (): typeof ALL_STEPS => {
    // Base steps always present
    const baseSteps = ALL_STEPS.filter(s => s.id === "shipment" || s.id === "issue")

    if (!formData.claimType) {
      // Before claim type selected, just show shipment and issue
      return baseSteps
    }

    switch (formData.claimType) {
      case "lostInTransit":
        // Lost in Transit: verification → description → submit
        return [
          ...baseSteps,
          ALL_STEPS.find(s => s.id === "verification")!,
          ALL_STEPS.find(s => s.id === "description")!,
        ]
      case "damage":
        // Damage: description → documentation → submit
        return [
          ...baseSteps,
          ALL_STEPS.find(s => s.id === "description")!,
          ALL_STEPS.find(s => s.id === "documentation")!,
        ]
      case "incorrectItems":
        // Incorrect Items: description → reshipping → compensation → documentation → submit
        return [
          ...baseSteps,
          ALL_STEPS.find(s => s.id === "description")!,
          ALL_STEPS.find(s => s.id === "reshipping")!,
          ALL_STEPS.find(s => s.id === "compensation")!,
          ALL_STEPS.find(s => s.id === "documentation")!,
        ]
      case "incorrectQuantity":
        // Incorrect Qty: description → reshipping → documentation → submit
        return [
          ...baseSteps,
          ALL_STEPS.find(s => s.id === "description")!,
          ALL_STEPS.find(s => s.id === "reshipping")!,
          ALL_STEPS.find(s => s.id === "documentation")!,
        ]
      default:
        return baseSteps
    }
  }

  // Verify Lost in Transit eligibility with AfterShip
  const verifyLostInTransit = async (shipmentId: string) => {
    setIsVerifyingLIT(true)
    setLitVerification(null)
    setError(null)

    try {
      const response = await fetch(`/api/data/shipments/${shipmentId}/verify-lost-in-transit`, {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to verify eligibility")
      }

      const result: VerifyLostInTransitResponse = await response.json()
      setLitVerification(result)
      // Don't set error for non-eligible - the verification UI displays this information
      return result
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to verify eligibility"
      setError(errorMessage)
      return null
    } finally {
      setIsVerifyingLIT(false)
    }
  }

  // Handle claim type selection
  const handleClaimTypeSelect = async (claimType: ClaimType) => {
    if (!eligibility) return

    const eligibilityInfo = eligibility.eligibility[claimType]
    const isEligible = eligibilityInfo.eligible

    setFormData(prev => ({ ...prev, claimType }))

    // For Lost in Transit with requiresVerification, trigger AfterShip check
    if (claimType === "lostInTransit" && isEligible && eligibilityInfo.requiresVerification) {
      // Clear any previous verification
      setLitVerification(null)
      // The verification will be triggered when they try to proceed
      setError(null)
      return
    }

    if (!isEligible) {
      setError(eligibilityInfo.reason || "Not eligible for this claim type")
    } else {
      setError(null)
    }
  }

  // Validate reshipment ID exists
  const validateReshipmentId = async (reshipmentId: string) => {
    if (!reshipmentId.trim()) {
      setReshipmentValid(false)
      setReshipmentError(null)
      return
    }

    setIsValidatingReshipment(true)
    setReshipmentError(null)
    setReshipmentValid(false)

    try {
      const response = await fetch(`/api/data/shipments/${reshipmentId.trim()}`)

      if (response.ok) {
        setReshipmentValid(true)
        setReshipmentError(null)
      } else if (response.status === 404) {
        setReshipmentValid(false)
        setReshipmentError("Shipment not found")
      } else if (response.status === 403) {
        setReshipmentValid(false)
        setReshipmentError("You don't have access to this shipment")
      } else {
        setReshipmentValid(false)
        setReshipmentError("Could not verify shipment")
      }
    } catch {
      setReshipmentValid(false)
      setReshipmentError("Could not verify shipment")
    } finally {
      setIsValidatingReshipment(false)
    }
  }

  // Debounce reshipment ID validation
  React.useEffect(() => {
    if (formData.reshipmentStatus !== "I've already reshipped") {
      setReshipmentValid(false)
      setReshipmentError(null)
      return
    }

    const timeoutId = setTimeout(() => {
      if (formData.reshipmentId.trim()) {
        validateReshipmentId(formData.reshipmentId)
      }
    }, 500)

    return () => clearTimeout(timeoutId)
  }, [formData.reshipmentId, formData.reshipmentStatus])

  // Navigate between steps
  const canProceed = (): boolean => {
    const applicableSteps = getApplicableSteps()
    const stepId = applicableSteps[currentStep]?.id

    switch (stepId) {
      case "shipment":
        // Just need a shipment ID entered - validation happens on Next click
        return formData.shipmentId.trim().length > 0
      case "issue":
        if (!formData.claimType) return false
        const eligibilityInfo = eligibility?.eligibility[formData.claimType]
        if (!eligibilityInfo?.eligible) return false
        return true
      case "verification":
        // Auto-advances when verified - but allow manual proceed if eligible
        return litVerification?.eligible === true
      case "description":
        // Description is REQUIRED for Incorrect Items and Incorrect Quantity
        if (formData.claimType === "incorrectItems" || formData.claimType === "incorrectQuantity") {
          return formData.description.trim().length > 0
        }
        // Loss and Damage - description is optional
        return true
      case "reshipping":
        if (!formData.reshipmentStatus) return false
        // If "I've already reshipped", require a validated reshipment ID
        if (formData.reshipmentStatus === "I've already reshipped") {
          return formData.reshipmentId.trim().length > 0 && reshipmentValid && !isValidatingReshipment
        }
        return true
      case "compensation":
        return !!formData.compensationRequest
      case "documentation":
        // All claim types with documentation step require photo + customer complaint
        const hasPhoto = formData.attachments.photo && formData.attachments.photo.length > 0
        const hasComplaint = formData.attachments.customerComplaint && formData.attachments.customerComplaint.length > 0
        return hasPhoto && hasComplaint
      default:
        return false
    }
  }

  const goNext = () => {
    const applicableSteps = getApplicableSteps()
    if (currentStep < applicableSteps.length - 1) {
      setCurrentStep(prev => prev + 1)
      setError(null)
    }
  }

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1)
      setError(null)
    }
  }

  // Submit the claim
  const handleSubmit = async () => {
    if (!shipmentSummary) {
      setError("Shipment data not loaded")
      return
    }
    if (!shipmentSummary.clientId) {
      setError("Shipment has no client ID")
      return
    }
    if (!formData.claimType) {
      setError("No claim type selected")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/data/care-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: shipmentSummary.clientId,
          ticketType: "Claim",
          issueType: claimTypeToIssueType(formData.claimType),
          status: "Under Review", // Claims start with Under Review status
          shipmentId: formData.shipmentId,
          orderId: shipmentSummary.orderId,
          carrier: shipmentSummary.carrier !== "—" ? shipmentSummary.carrier : null,
          trackingNumber: shipmentSummary.trackingId !== "—" ? shipmentSummary.trackingId : null,
          shipDate: shipmentSummary.labelCreated !== "—" ? shipmentSummary.labelCreated : null,
          description: formData.description || null,
          reshipmentStatus: formData.reshipmentStatus,
          reshipmentId: formData.reshipmentId || null,
          compensationRequest: formData.compensationRequest,
          // Flatten structured attachments into array for API
          // Include path for generating fresh signed URLs when sending emails
          attachments: [
            ...formData.attachments.photo.map(f => ({ name: f.name, url: f.url, path: f.path, type: f.type, category: 'photo' })),
            ...formData.attachments.customerComplaint.map(f => ({ name: f.name, url: f.url, path: f.path, type: f.type, category: 'customerComplaint' })),
            ...formData.attachments.otherDocs.map(f => ({ name: f.name, url: f.url, path: f.path, type: f.type, category: 'otherDocs' })),
          ],
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to submit claim")
      }

      const result = await response.json()
      setTicketNumber(result.ticket.ticket_number)
      setSubmitSuccess(true)
      onSuccess?.(result.ticket.ticket_number)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit claim")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Render current step content
  const renderStepContent = () => {
    const applicableSteps = getApplicableSteps()
    const stepId = applicableSteps[currentStep]?.id

    if (submitSuccess) {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="rounded-full bg-green-100 p-3">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">Claim Submitted</h3>
            <p className="text-muted-foreground mt-1">
              Your claim has been submitted successfully.
            </p>
            {ticketNumber && (
              <p className="text-sm mt-2">
                Ticket Number: <span className="font-mono font-semibold">#{ticketNumber}</span>
              </p>
            )}
          </div>
          <Button onClick={() => onOpenChange(false)} className="mt-4">
            Close
          </Button>
        </div>
      )
    }

    switch (stepId) {
      case "shipment":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="shipmentId" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Shipment ID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="shipmentId"
                placeholder="e.g., 330867617"
                value={formData.shipmentId}
                onChange={(e) => setFormData(prev => ({ ...prev, shipmentId: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && formData.shipmentId.trim() && handleShipmentStepNext()}
                className="h-9 placeholder:text-muted-foreground/40"
              />
            </div>
          </div>
        )

      case "issue":
        return (
          <div className="space-y-4">
            {/* Shipment summary at top */}
            {shipmentSummary && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Shipment {shipmentSummary.shipmentId}</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    shipmentSummary.status === "Delivered" && "bg-green-100 text-green-700",
                    shipmentSummary.status === "In Transit" && "bg-blue-100 text-blue-700",
                    !["Delivered", "In Transit"].includes(shipmentSummary.status) && "bg-gray-100 text-gray-700"
                  )}>
                    {shipmentSummary.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Order ID:</span>{" "}
                    <span className="font-mono">{shipmentSummary.orderId}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Customer:</span>{" "}
                    {shipmentSummary.customer}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Carrier:</span>{" "}
                    {shipmentSummary.carrier}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Label Created:</span>{" "}
                    {shipmentSummary.labelCreated}
                  </div>
                </div>
              </div>
            )}

            {/* Check if any claim types are eligible */}
            {(() => {
              const allClaimTypes: ClaimType[] = ["lostInTransit", "damage", "incorrectItems", "incorrectQuantity"]
              const hasAnyEligible = allClaimTypes.some(type => eligibility?.eligibility[type]?.eligible)

              if (!hasAnyEligible && eligibility) {
                // No claim types eligible - show friendly message
                return (
                  <div className="rounded-lg border border-muted bg-muted/30 p-6 text-center">
                    <Package className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">
                      This shipment is still on its way and is not eligible for any types of claim filing.
                      Let&apos;s keep an eye on it!
                    </p>
                  </div>
                )
              }

              // At least one claim type is eligible - show options
              return (
                <>
                  <p className="text-muted-foreground">What seems to be the trouble?</p>
                  <div className="grid gap-2">
                    {allClaimTypes.map((type) => {
                      const typeEligibility = eligibility?.eligibility[type]
                      const isEligible = typeEligibility?.eligible ?? false

                      return (
                        <button
                          key={type}
                          className={cn(
                            "flex items-center justify-between p-4 rounded-lg border text-left transition-colors",
                            formData.claimType === type && "border-primary bg-primary/5",
                            !isEligible && "opacity-60",
                            isEligible && formData.claimType !== type && "hover:border-muted-foreground/50"
                          )}
                          onClick={() => handleClaimTypeSelect(type)}
                        >
                          <span className="font-medium">{getClaimTypeLabel(type)}</span>
                          {!isEligible && (
                            <AlertCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </div>
        )

      case "verification":
        return (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-muted-foreground">
                Verifying carrier tracking records for Lost in Transit eligibility...
              </p>
            </div>

            {/* Progress/Status Area */}
            <div className="rounded-lg border p-6">
              {(isVerifyingLIT || isLoading) && (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-muted animate-pulse" />
                    <JetpackLoader size="lg" className="absolute inset-0 m-auto" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">Checking Carrier Records</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Contacting carrier to verify last tracking activity...
                    </p>
                  </div>
                </div>
              )}

              {litVerification && litVerification.eligible && (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-green-600">Eligible for Lost in Transit Claim</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Last carrier scan was {litVerification.daysSinceLastScan} days ago
                      {litVerification.lastScanDate && (
                        <> on {new Date(litVerification.lastScanDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}</>
                      )}.
                    </p>
                  </div>
                </div>
              )}

              {litVerification && !litVerification.eligible && (
                <div className="space-y-5">
                  {/* Main message - big number focus */}
                  <div className="text-center">
                    <div className="text-amber-600 font-medium mb-3">Not Yet Eligible</div>
                    {litVerification.daysRemaining && (
                      <div className="text-4xl font-bold text-foreground">
                        {litVerification.daysRemaining} day{litVerification.daysRemaining === 1 ? '' : 's'}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground mt-1">
                      until eligible
                    </div>
                  </div>

                  {/* Compact info row */}
                  {litVerification.lastScanDate && (
                    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5" />
                        <span>Last scan: {new Date(litVerification.lastScanDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                      <span className="text-muted-foreground/50">·</span>
                      <span>{litVerification.isInternational ? 'International' : 'Domestic'} ({litVerification.requiredDays} days required)</span>
                    </div>
                  )}

                  {/* Status detail - collapsed by default feel */}
                  {litVerification.lastScanDescription && (
                    <div className="text-xs text-muted-foreground/70 text-center px-4">
                      {litVerification.lastScanDescription}
                    </div>
                  )}
                </div>
              )}

              {!isVerifyingLIT && !isLoading && !litVerification && !error && (
                <div className="text-center text-muted-foreground">
                  <p>Verification pending...</p>
                </div>
              )}

              {!isVerifyingLIT && !isLoading && !litVerification && error && (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-red-600">Verification Failed</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {error}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setError(null)
                      verifyLostInTransit(formData.shipmentId)
                    }}
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </div>
          </div>
        )

      case "description":
        const isPickOrShortShip = formData.claimType === "incorrectItems" || formData.claimType === "incorrectQuantity"
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {isPickOrShortShip ? (
                  <>Description <span className="text-red-500">*</span></>
                ) : (
                  <>Description <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">(optional)</span></>
                )}
              </Label>
              <Textarea
                id="description"
                placeholder="Include relevant context, descriptions, or communications with customer..."
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={5}
                className="placeholder:text-muted-foreground/40"
              />
            </div>
          </div>
        )

      case "reshipping":
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Reshipping Options
              <span className="block text-xs mt-1">Reshipments eligible for credit only if picking error</span>
            </p>
            <div className="grid gap-2">
              {(["Please reship for me", "I've already reshipped", "Don't reship"] as ReshipmentOption[]).map((option) => (
                <button
                  key={option}
                  className={cn(
                    "p-4 rounded-lg border text-left transition-colors",
                    formData.reshipmentStatus === option && "border-primary bg-primary/5",
                    formData.reshipmentStatus !== option && "hover:border-muted-foreground/50"
                  )}
                  onClick={() => setFormData(prev => ({ ...prev, reshipmentStatus: option }))}
                >
                  {option}
                </button>
              ))}
            </div>

            {formData.reshipmentStatus === "I've already reshipped" && (
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="reshipmentId" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Reshipment ID <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="reshipmentId"
                    placeholder="e.g., 330867618"
                    value={formData.reshipmentId}
                    onChange={(e) => setFormData(prev => ({ ...prev, reshipmentId: e.target.value }))}
                    className={cn(
                      "h-9 placeholder:text-muted-foreground/40",
                      reshipmentValid && "border-green-500 pr-10",
                      reshipmentError && "border-destructive pr-10"
                    )}
                  />
                  {isValidatingReshipment && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <JetpackLoader size="sm" />
                    </div>
                  )}
                  {!isValidatingReshipment && reshipmentValid && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Check className="h-4 w-4 text-green-500" />
                    </div>
                  )}
                  {!isValidatingReshipment && reshipmentError && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    </div>
                  )}
                </div>
                {reshipmentError && (
                  <p className="text-sm text-destructive">{reshipmentError}</p>
                )}
              </div>
            )}
          </div>
        )

      case "compensation":
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground">How should we compensate you?</p>
            <div className="grid gap-2">
              {(["Credit me the item's manufacturing cost", "Create a return label for me"] as CompensationOption[]).map((option) => (
                <button
                  key={option}
                  className={cn(
                    "p-4 rounded-lg border text-left transition-colors",
                    formData.compensationRequest === option && "border-primary bg-primary/5",
                    formData.compensationRequest !== option && "hover:border-muted-foreground/50"
                  )}
                  onClick={() => setFormData(prev => ({ ...prev, compensationRequest: option }))}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )

      case "documentation":
        const isDamage = formData.claimType === "damage"
        const photoLabel = isDamage
          ? "Photo Showing Damaged Item(s)"
          : "Photo Showing Incorrect Item(s)"

        // Calculate bytes used by each attachment category for shared 15MB budget
        const TOTAL_BUDGET_MB = 15
        const photoBytes = formData.attachments.photo.reduce((sum, f) => sum + f.size, 0)
        const complaintBytes = formData.attachments.customerComplaint.reduce((sum, f) => sum + f.size, 0)
        const otherBytes = formData.attachments.otherDocs.reduce((sum, f) => sum + f.size, 0)

        return (
          <div className="space-y-5">
            {/* Field 1: Photo - REQUIRED (single file) */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                {photoLabel}
                {formData.attachments.photo.length > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <span className="text-red-500">*</span>
                )}
              </Label>
              <FileUpload
                value={formData.attachments.photo}
                onChange={(files) => setFormData(prev => ({
                  ...prev,
                  attachments: { ...prev.attachments, photo: files }
                }))}
                accept="image/png,image/jpeg"
                maxSizeMb={TOTAL_BUDGET_MB}
                singleFile
                totalBudgetMb={TOTAL_BUDGET_MB}
                usedBudgetBytes={complaintBytes + otherBytes}
              />
            </div>

            {/* Field 2: Customer Complaint - REQUIRED (single file) */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                Screenshot of Customer Complaint
                {formData.attachments.customerComplaint.length > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <span className="text-red-500">*</span>
                )}
              </Label>
              <FileUpload
                value={formData.attachments.customerComplaint}
                onChange={(files) => setFormData(prev => ({
                  ...prev,
                  attachments: { ...prev.attachments, customerComplaint: files }
                }))}
                accept="image/png,image/jpeg"
                maxSizeMb={TOTAL_BUDGET_MB}
                singleFile
                totalBudgetMb={TOTAL_BUDGET_MB}
                usedBudgetBytes={photoBytes + otherBytes}
              />
            </div>

            {/* Field 3: Other Docs - OPTIONAL */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Any Other Documentation <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">(optional)</span>
              </Label>
              <FileUpload
                value={formData.attachments.otherDocs}
                onChange={(files) => setFormData(prev => ({
                  ...prev,
                  attachments: { ...prev.attachments, otherDocs: files }
                }))}
                accept="image/png,image/jpeg,application/pdf,.xlsx,.xls,.csv"
                maxSizeMb={TOTAL_BUDGET_MB}
                totalBudgetMb={TOTAL_BUDGET_MB}
                usedBudgetBytes={photoBytes + complaintBytes}
              />
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const applicableSteps = getApplicableSteps()
  const isLastStep = currentStep === applicableSteps.length - 1

  // Show 4 steps as default until claim type is selected, then show actual count
  const displayStepCount = formData.claimType ? applicableSteps.length : 4
  const displaySteps = formData.claimType
    ? applicableSteps
    : Array.from({ length: 4 }, (_, i) => ({ id: `placeholder-${i}`, title: '' }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Submit a Claim</DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center justify-between">
              {!submitSuccess && applicableSteps[currentStep] && (
                <span>
                  Step {currentStep + 1} of {displayStepCount}: {applicableSteps[currentStep].title}
                </span>
              )}
              {!submitSuccess && applicableSteps[currentStep]?.id === "documentation" && (
                <span className="text-xs">
                  15MB max ({((formData.attachments.photo.reduce((s, f) => s + f.size, 0) + formData.attachments.customerComplaint.reduce((s, f) => s + f.size, 0) + formData.attachments.otherDocs.reduce((s, f) => s + f.size, 0)) / (1024 * 1024)).toFixed(1)}MB used)
                </span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        {!submitSuccess && (
          <div className="flex gap-1 mb-2">
            {displaySteps.map((_, index) => (
              <div
                key={index}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  index <= currentStep ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
        )}

        {/* Error message */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step content */}
        <div className="min-h-[200px]">
          {renderStepContent()}
        </div>

        {/* Navigation */}
        {!submitSuccess && (
          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={currentStep === 0 || isSubmitting || isVerifyingLIT}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            {isLastStep ? (
              <Button
                onClick={handleSubmit}
                disabled={!canProceed() || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <JetpackLoader size="sm" className="mr-2" />
                    Submitting...
                  </>
                ) : (
                  "Submit Claim"
                )}
              </Button>
            ) : applicableSteps[currentStep]?.id === "verification" ? (
              // Verification step - show Continue when eligible, Close when not eligible
              isVerifyingLIT || isLoading ? (
                <Button disabled>
                  <JetpackLoader size="sm" className="mr-2" />
                  Verifying...
                </Button>
              ) : litVerification?.eligible ? (
                <Button onClick={goNext}>
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : litVerification && !litVerification.eligible ? (
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              ) : (
                <Button disabled>
                  Waiting for Verification
                </Button>
              )
            ) : applicableSteps[currentStep]?.id === "shipment" ? (
              // Shipment step - fetch data on Next, then advance
              <Button
                onClick={handleShipmentStepNext}
                disabled={!canProceed() || isLoading}
              >
                {isLoading ? (
                  <>
                    <JetpackLoader size="sm" className="mr-2" />
                    Loading...
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={goNext}
                disabled={!canProceed() || isLoading}
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
