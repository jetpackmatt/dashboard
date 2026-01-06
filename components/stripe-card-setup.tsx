"use client"

import * as React from "react"
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js"
import { Button } from "@/components/ui/button"
import { AlertCircleIcon, LoaderIcon } from "lucide-react"

interface StripeCardSetupProps {
  onSuccess: (paymentMethodId: string) => void
  onCancel: () => void
}

export function StripeCardSetup({ onSuccess, onCancel }: StripeCardSetupProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsLoading(true)
    setError(null)

    const { error: submitError, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard/billing?setup=complete`,
      },
      redirect: "if_required",
    })

    if (submitError) {
      setError(submitError.message || "An error occurred while saving your card.")
      setIsLoading(false)
    } else if (setupIntent?.payment_method) {
      // Setup succeeded - pass payment method ID to parent
      const paymentMethodId = typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method.id
      onSuccess(paymentMethodId)
    } else {
      setError("Card saved but could not retrieve payment method ID.")
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/50">
          <AlertCircleIcon className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || isLoading}>
          {isLoading ? (
            <>
              <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Card"
          )}
        </Button>
      </div>
    </form>
  )
}
