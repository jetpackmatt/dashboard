"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CreditCardIcon,
  BuildingIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  CopyIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDotIcon,
  LoaderIcon,
} from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useClient } from "@/components/client-context"
import { Skeleton } from "@/components/ui/skeleton"
import { StripeProvider } from "@/components/stripe-provider"
import { StripeCardSetup } from "@/components/stripe-card-setup"
import { BillingEmailManager } from "@/components/billing/billing-email-manager"

interface BillingAddress {
  street?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
}

interface BillingData {
  billingAddress: BillingAddress | null
  billingEmail: string | null
  billingEmails: string[]
  companyName: string | null
  paymentMethod: 'ach' | 'credit_card'
  outstandingBalance: number
  unpaidInvoiceCount: number
}

// Copy button component
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="ml-2 p-1 rounded hover:bg-muted transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

export default function BillingPage() {
  const router = useRouter()
  const { selectedClientId, clients, effectiveIsAdmin, isLoading: clientLoading } = useClient()

  // For non-admin users, use their first (and likely only) client if no selection
  const clientId = selectedClientId || (clients.length > 0 ? clients[0].id : null)

  // Redirect admins - they shouldn't see this page
  React.useEffect(() => {
    if (!clientLoading && effectiveIsAdmin) {
      router.replace("/dashboard")
    }
  }, [effectiveIsAdmin, clientLoading, router])

  // Billing data from API
  const [billingData, setBillingData] = React.useState<BillingData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  // Payment method state - synced from DB
  const [showStripeSetup, setShowStripeSetup] = React.useState(false)
  const [stripeClientSecret, setStripeClientSecret] = React.useState<string | null>(null)
  const [isLoadingStripe, setIsLoadingStripe] = React.useState(false)

  // Derive ccBillingEnabled from billingData
  const ccBillingEnabled = billingData?.paymentMethod === 'credit_card'

  // Fetch billing data
  React.useEffect(() => {
    if (!clientId || effectiveIsAdmin) return

    const fetchBillingData = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/data/billing?clientId=${clientId}`)
        if (response.ok) {
          const data = await response.json()
          setBillingData(data)
        }
      } catch (error) {
        console.error("Error fetching billing data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchBillingData()
  }, [clientId, effectiveIsAdmin])

  // Show loading while checking admin status
  if (clientLoading || effectiveIsAdmin) {
    return (
      <>
        <SiteHeader sectionName="Billing" />
        <div className="flex flex-1 flex-col items-center justify-center">
          <LoaderIcon className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }

  const outstandingBalance = billingData?.outstandingBalance || 0
  const unpaidInvoiceCount = billingData?.unpaidInvoiceCount || 0
  const billingAddress = billingData?.billingAddress
  const billingEmail = billingData?.billingEmail
  const billingEmails = billingData?.billingEmails || []
  const companyName = billingData?.companyName

  // Handle billing emails update
  const handleBillingEmailsUpdate = (updatedEmails: string[]) => {
    setBillingData(prev => prev ? { ...prev, billingEmails: updatedEmails } : null)
  }

  // Save payment method to database
  const savePaymentMethod = async (method: 'ach' | 'credit_card', stripePaymentMethodId?: string) => {
    if (!clientId) return

    setIsSaving(true)
    try {
      const response = await fetch('/api/data/billing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          paymentMethod: method,
          ...(stripePaymentMethodId && { stripePaymentMethodId }),
        }),
      })

      if (response.ok) {
        setBillingData(prev => prev ? { ...prev, paymentMethod: method } : null)
      }
    } catch (error) {
      console.error('Error saving payment method:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCcToggle = async (enabled: boolean) => {
    if (enabled) {
      // Fetch SetupIntent and show Stripe dialog
      setIsLoadingStripe(true)
      setShowStripeSetup(true)

      try {
        const response = await fetch('/api/stripe/setup-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId }),
        })

        if (response.ok) {
          const data = await response.json()
          setStripeClientSecret(data.clientSecret)
        } else {
          console.error('Failed to create SetupIntent')
          setShowStripeSetup(false)
        }
      } catch (error) {
        console.error('Error creating SetupIntent:', error)
        setShowStripeSetup(false)
      } finally {
        setIsLoadingStripe(false)
      }
    } else {
      // Switch back to ACH
      savePaymentMethod('ach')
    }
  }

  const handleStripeSuccess = async (paymentMethodId: string) => {
    // Card saved successfully - update payment method and store payment method ID
    await savePaymentMethod('credit_card', paymentMethodId)
    setShowStripeSetup(false)
    setStripeClientSecret(null)
  }

  const handleStripeCancel = () => {
    setShowStripeSetup(false)
    setStripeClientSecret(null)
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return (
    <>
      <SiteHeader sectionName="Billing" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-1 flex-col w-full">
          <div className="flex flex-col gap-6 py-6 w-full px-4 lg:px-6">

            {/* Top Row - Balance & Payment Method */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Outstanding Balance Card */}
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className={`h-2 w-2 rounded-full ${outstandingBalance > 0 ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`} />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Outstanding Balance
                  </span>
                </div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mb-3">
                  {formatCurrency(outstandingBalance)}
                </div>
                {isLoading ? (
                  <Skeleton className="h-5 w-40" />
                ) : unpaidInvoiceCount > 0 ? (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {unpaidInvoiceCount} invoice{unpaidInvoiceCount > 1 ? 's' : ''} awaiting payment
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/dashboard/invoices")}
                      className="group"
                    >
                      View
                      <ChevronRightIcon className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2Icon className="h-4 w-4" />
                    All invoices paid
                  </p>
                )}
              </div>

              {/* Payment Method Card */}
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Payment Method
                  </span>
                  <Badge
                    variant="outline"
                    className={ccBillingEnabled
                      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                    }
                  >
                    <CircleDotIcon className="h-3 w-3 mr-1.5" />
                    {ccBillingEnabled ? "Credit Card" : "ACH/Wire"}
                  </Badge>
                </div>

                <div className="space-y-2">
                  {/* ACH Option */}
                  <div className={`relative rounded-lg border-2 transition-all ${
                    !ccBillingEnabled
                      ? 'border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/20'
                      : 'border-transparent bg-muted/30 hover:bg-muted/50'
                  }`}>
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <BuildingIcon className={`h-5 w-5 ${!ccBillingEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">ACH / Wire</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-0">
                              No fees
                            </Badge>
                          </div>
                        </div>
                      </div>
                      {!ccBillingEnabled && (
                        <CheckCircle2Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </div>
                  </div>

                  {/* Credit Card Option */}
                  <div className={`relative rounded-lg border-2 transition-all ${
                    ccBillingEnabled
                      ? 'border-blue-500/50 bg-blue-50/30 dark:bg-blue-950/20'
                      : 'border-transparent bg-muted/30 hover:bg-muted/50'
                  }`}>
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <CreditCardIcon className={`h-5 w-5 ${ccBillingEnabled ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Credit Card</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border-0">
                              3% fee
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Switch
                        checked={ccBillingEnabled}
                        onCheckedChange={handleCcToggle}
                        disabled={isSaving}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Row - Wire Details & Billing Info */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Wire Transfer Details Card */}
              <div className="rounded-xl border bg-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Wire Transfer Details
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Bank</p>
                      <p className="text-sm font-medium mt-0.5">Column National Association</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Beneficiary</p>
                      <p className="text-sm font-medium mt-0.5">Jetpack Ventures Inc.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Account #</p>
                      <div className="flex items-center mt-0.5">
                        <p className="text-sm font-medium tabular-nums">489159369530363</p>
                        <CopyButton value="489159369530363" />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Routing #</p>
                      <div className="flex items-center mt-0.5">
                        <p className="text-sm font-medium tabular-nums">084009519</p>
                        <CopyButton value="084009519" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Bank Address</p>
                    <p className="text-sm mt-0.5">
                      30 W. 26th Street, 6th Floor, New York, NY 10010
                    </p>
                  </div>

                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/50">
                    <AlertCircleIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Include invoice number in payment reference
                    </p>
                  </div>
                </div>
              </div>

              {/* Billing Information Card */}
              <div className="rounded-xl border bg-card p-6 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Billing Information
                  </span>
                  {/* Edit functionality disabled for now - requires API endpoint */}
                </div>

                {isLoading ? (
                  <div className="space-y-4 flex-1">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Company</p>
                        <Skeleton className="h-5 w-32 mt-0.5" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Email</p>
                        <Skeleton className="h-5 w-40 mt-0.5" />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Address</p>
                      <Skeleton className="h-16 w-full mt-0.5" />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-6 flex-1">
                    {/* Left column - Company and Address */}
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Company</p>
                        <p className="text-sm font-medium mt-0.5">{companyName || "Not set"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Address</p>
                        {billingAddress ? (
                          <p className="text-sm mt-0.5">
                            {billingAddress.street && <>{billingAddress.street}<br /></>}
                            {billingAddress.city && billingAddress.region && (
                              <>{billingAddress.city}, {billingAddress.region} {billingAddress.postalCode}<br /></>
                            )}
                            {billingAddress.country}
                          </p>
                        ) : (
                          <p className="text-sm mt-0.5 text-muted-foreground">Not set</p>
                        )}
                      </div>
                    </div>

                    {/* Right column - Invoice Emails */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Invoice Emails</p>
                      {clientId ? (
                        <BillingEmailManager
                          emails={billingEmails}
                          clientId={clientId}
                          onUpdate={handleBillingEmailsUpdate}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">No client selected</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stripe Setup Dialog */}
      <Dialog open={showStripeSetup} onOpenChange={(open) => {
        if (!open) handleStripeCancel()
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Up Credit Card</DialogTitle>
            <DialogDescription>
              Enable automatic payments with a 3% processing fee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Outstanding balance notice - CC only applies to future invoices */}
            {outstandingBalance > 0 && (
              <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircleIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-blue-800 dark:text-blue-200">
                      Outstanding Balance: {formatCurrency(outstandingBalance)}
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      This credit card can only be charged for future invoices. Outstanding balances on existing invoices will not be auto-paid. Please pay any unpaid invoices by wire/ACH, or reach out to us on Slack to arrange payment.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 3% fee warning */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/50">
              <AlertCircleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                A 3% processing fee applies to all credit card payments. ACH/Wire transfers have no fees.
              </p>
            </div>

            {isLoadingStripe ? (
              <div className="flex items-center justify-center py-8">
                <LoaderIcon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : stripeClientSecret ? (
              <StripeProvider clientSecret={stripeClientSecret}>
                <StripeCardSetup
                  onSuccess={handleStripeSuccess}
                  onCancel={handleStripeCancel}
                />
              </StripeProvider>
            ) : (
              <div className="rounded-xl border-2 border-dashed bg-muted/30 p-8 text-center">
                <CreditCardIcon className="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Unable to load payment form
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
