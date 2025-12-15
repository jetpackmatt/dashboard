"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  CreditCardIcon,
  BuildingIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  PencilIcon,
  TrendingDownIcon,
  CalendarIcon,
  FileTextIcon,
  BanknoteIcon,
  ShieldCheckIcon,
  InfoIcon,
} from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import invoicesData from "../invoices-data.json"

interface BillingDetails {
  companyName: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  email: string
  taxId: string
}

export default function BillingPage() {
  const router = useRouter()

  // Payment method state
  const [ccBillingEnabled, setCcBillingEnabled] = React.useState(false)
  const [showStripeSetup, setShowStripeSetup] = React.useState(false)
  const [stripeSetupComplete, setStripeSetupComplete] = React.useState(false)

  // Billing details state
  const [isEditingDetails, setIsEditingDetails] = React.useState(false)
  const [billingDetails, setBillingDetails] = React.useState<BillingDetails>({
    companyName: "Acme Corporation",
    address: "123 Business Street",
    city: "San Francisco",
    state: "CA",
    zip: "94105",
    country: "United States",
    email: "billing@acme.com",
    taxId: "12-3456789",
  })

  // Calculate outstanding balance from unpaid invoices
  const unpaidInvoices = invoicesData.filter(inv => inv.status === "Unpaid")
  const outstandingBalance = unpaidInvoices.reduce((sum, inv) => sum + inv.amount, 0)
  const recentInvoices = invoicesData.slice(0, 5)

  const handleCcToggle = (enabled: boolean) => {
    if (enabled && !stripeSetupComplete) {
      setShowStripeSetup(true)
    }
    setCcBillingEnabled(enabled)
  }

  const handleStripeSetup = () => {
    // Simulate Stripe setup
    setTimeout(() => {
      setStripeSetupComplete(true)
      setShowStripeSetup(false)
      setCcBillingEnabled(true)
    }, 1000)
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    })
  }

  return (
    <>
      <SiteHeader sectionName="Billing" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full px-4 lg:px-6">
            {/* Description Text */}
            <p className="text-sm text-muted-foreground">
              Manage your payment methods, billing details, and view your account balance.
            </p>

            {/* Top Row - Outstanding Balance & Payment Method */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Outstanding Balance - Featured */}
              <Card className="lg:col-span-1 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/50 dark:to-background">
                <CardHeader>
                  <CardDescription>Outstanding Balance</CardDescription>
                  <CardTitle className="text-4xl font-bold tabular-nums">
                    {formatCurrency(outstandingBalance)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {unpaidInvoices.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <AlertCircleIcon className="h-4 w-4" />
                        <span>{unpaidInvoices.length} unpaid invoice(s)</span>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => router.push("/dashboard/invoices")}
                      >
                        View Invoices
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle2Icon className="h-4 w-4" />
                      <span>All invoices paid</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Payment Method Status */}
              <Card className="lg:col-span-2 bg-gradient-to-br from-emerald-50/30 to-white dark:from-emerald-950/10 dark:to-background">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Payment Method</CardTitle>
                      <CardDescription>
                        Choose how you want to pay your invoices
                      </CardDescription>
                    </div>
                    <Badge
                      variant={ccBillingEnabled ? "default" : "outline"}
                      className={ccBillingEnabled ? "font-medium" : "font-medium bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"}
                    >
                      {ccBillingEnabled ? "Credit Card" : "ACH/Wire Transfer"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-4">
                      <CreditCardIcon className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Credit Card (Automatic)</p>
                        <p className="text-sm text-muted-foreground">
                          {stripeSetupComplete
                            ? "Visa ending in 4242 • Expires 12/25"
                            : "Pay automatically with 3% processing fee"}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={ccBillingEnabled}
                      onCheckedChange={handleCcToggle}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
                    <div className="flex items-center gap-4">
                      <BuildingIcon className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">ACH/Wire Transfer</p>
                          <Badge variant="secondary" className="text-xs">
                            <TrendingDownIcon className="h-3 w-3 mr-1" />
                            No Fees
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Recommended - Transfer funds directly to Jetpack
                        </p>
                      </div>
                    </div>
                  </div>

                  {ccBillingEnabled && (
                    <Alert>
                      <InfoIcon className="h-4 w-4" />
                      <AlertTitle>Credit Card Processing Fee</AlertTitle>
                      <AlertDescription>
                        A 3% processing fee will be added to all invoices. We recommend using ACH/Wire transfer to avoid this fee.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Payment Terms Notice */}
            <Alert>
              <CalendarIcon className="h-4 w-4" />
              <AlertTitle>Payment Terms</AlertTitle>
              <AlertDescription>
                Payment is due promptly upon receipt of invoice. Credit card payments are charged automatically at invoice issue.
                ACH/Wire transfers must be sent upon receipt of the invoice.
              </AlertDescription>
            </Alert>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Billing Details */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Billing Details</CardTitle>
                      <CardDescription>
                        Your company information for invoicing
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingDetails(!isEditingDetails)}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {isEditingDetails ? (
                    <div className="space-y-4">
                      <div className="grid gap-2">
                        <Label htmlFor="companyName">Company Name</Label>
                        <Input
                          id="companyName"
                          value={billingDetails.companyName}
                          onChange={(e) => setBillingDetails({...billingDetails, companyName: e.target.value})}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="address">Address</Label>
                        <Input
                          id="address"
                          value={billingDetails.address}
                          onChange={(e) => setBillingDetails({...billingDetails, address: e.target.value})}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="city">City</Label>
                          <Input
                            id="city"
                            value={billingDetails.city}
                            onChange={(e) => setBillingDetails({...billingDetails, city: e.target.value})}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="state">State</Label>
                          <Input
                            id="state"
                            value={billingDetails.state}
                            onChange={(e) => setBillingDetails({...billingDetails, state: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="zip">ZIP Code</Label>
                          <Input
                            id="zip"
                            value={billingDetails.zip}
                            onChange={(e) => setBillingDetails({...billingDetails, zip: e.target.value})}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="country">Country</Label>
                          <Input
                            id="country"
                            value={billingDetails.country}
                            onChange={(e) => setBillingDetails({...billingDetails, country: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="email">Billing Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={billingDetails.email}
                          onChange={(e) => setBillingDetails({...billingDetails, email: e.target.value})}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="taxId">Tax ID / VAT Number</Label>
                        <Input
                          id="taxId"
                          value={billingDetails.taxId}
                          onChange={(e) => setBillingDetails({...billingDetails, taxId: e.target.value})}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => setIsEditingDetails(false)}>
                          Save Changes
                        </Button>
                        <Button variant="outline" onClick={() => setIsEditingDetails(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Company</p>
                        <p className="text-base">{billingDetails.companyName}</p>
                      </div>
                      <Separator />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Address</p>
                        <p className="text-base">{billingDetails.address}</p>
                        <p className="text-base">
                          {billingDetails.city}, {billingDetails.state} {billingDetails.zip}
                        </p>
                        <p className="text-base">{billingDetails.country}</p>
                      </div>
                      <Separator />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Billing Email</p>
                        <p className="text-base">{billingDetails.email}</p>
                      </div>
                      <Separator />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Tax ID</p>
                        <p className="text-base">{billingDetails.taxId}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Wire Transfer Instructions */}
              <Card className="bg-gradient-to-br from-blue-50/50 to-white dark:from-blue-950/20 dark:to-background">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BanknoteIcon className="h-5 w-5" />
                    <CardTitle>Wire Transfer Instructions</CardTitle>
                  </div>
                  <CardDescription>
                    Use these details to send ACH or wire payments
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Bank Name</p>
                      <p className="text-base font-medium">Column National Association</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Bank Address</p>
                      <p className="text-base">30 W. 26th Street, Sixth Floor</p>
                      <p className="text-base">New York, NY 10010, USA</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Account Holder</p>
                      <p className="text-base font-medium">Jetpack Ventures Inc.</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Account Type</p>
                      <p className="text-base">Checking</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Account Number</p>
                      <p className="text-base font-mono">489159369530363</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Routing Number (ACH)</p>
                      <p className="text-base font-mono">084009519</p>
                    </div>
                  </div>

                  <Alert>
                    <ShieldCheckIcon className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      Always include your invoice number in the payment reference to ensure proper credit to your account.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </div>

            {/* Recent Invoices Summary */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Invoices</CardTitle>
                    <CardDescription>
                      Your latest invoices and payment history
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => router.push("/dashboard/invoices")}
                  >
                    View All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted">
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">Download</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentInvoices.map((invoice) => (
                        <TableRow key={invoice.invoiceNumber}>
                          <TableCell className="font-mono text-sm">
                            {invoice.invoiceNumber}
                          </TableCell>
                          <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(invoice.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={invoice.status === "Paid"
                                ? "font-medium bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
                                : "font-medium bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"}
                            >
                              {invoice.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <FileTextIcon className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Stripe Setup Dialog */}
      <Dialog open={showStripeSetup} onOpenChange={setShowStripeSetup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Up Credit Card Payment</DialogTitle>
            <DialogDescription>
              Connect your credit card to enable automatic payments. A 3% processing fee will be added to all invoices.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert>
              <AlertCircleIcon className="h-4 w-4" />
              <AlertTitle>Processing Fee Notice</AlertTitle>
              <AlertDescription>
                Credit card payments incur a 3% processing fee. Consider using ACH/Wire transfer for no fees.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>Card Information</Label>
              <div className="rounded-lg border bg-muted/50 p-6 text-center">
                <CreditCardIcon className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Stripe payment form will appear here
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowStripeSetup(false)
              setCcBillingEnabled(false)
            }}>
              Cancel
            </Button>
            <Button onClick={handleStripeSetup}>
              Set Up Payment Method
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
