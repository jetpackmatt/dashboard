"use client"

import { Elements } from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

interface StripeProviderProps {
  children: React.ReactNode
  clientSecret?: string
}

export function StripeProvider({ children, clientSecret }: StripeProviderProps) {
  const options = clientSecret
    ? {
        clientSecret,
        appearance: {
          theme: "stripe" as const,
          variables: {
            colorPrimary: "#10b981", // emerald-500
            colorBackground: "#ffffff",
            colorText: "#1f2937",
            colorDanger: "#ef4444",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            borderRadius: "8px",
          },
        },
      }
    : undefined

  if (!clientSecret) {
    return <>{children}</>
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  )
}
