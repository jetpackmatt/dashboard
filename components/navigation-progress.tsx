"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { usePathname } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"

const SECTION_NAMES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/transactions": "Transactions",
  "/dashboard/analytics": "Analytics",
  "/dashboard/care": "Jetpack Care",
  "/dashboard/invoices": "Invoices",
  "/dashboard/billing": "Billing",
  "/dashboard/deliveryiq": "Delivery IQ",
  "/dashboard/admin": "Admin",
  "/dashboard/financials": "Financials",
  "/dashboard/misfits": "Misfits",
  "/dashboard/settings": "Settings",
}

interface NavigationProgressContextValue {
  startNavigation: (targetUrl: string) => void
  pendingPath: string | null
}

const NavigationProgressContext = createContext<NavigationProgressContextValue>({
  startNavigation: () => {},
  pendingPath: null,
})

export function useNavigationProgress() {
  return useContext(NavigationProgressContext)
}

export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  // Clear pending state when pathname catches up (navigation completed)
  useEffect(() => {
    setPendingPath(null)
  }, [pathname])


  const startNavigation = useCallback((targetUrl: string) => {
    const path = targetUrl.split("?")[0]
    if (path !== pathname) {
      setPendingPath(path)
    }
  }, [pathname])

  return (
    <NavigationProgressContext.Provider value={{ startNavigation, pendingPath }}>
      {children}
    </NavigationProgressContext.Provider>
  )
}

export function NavigationProgressGate({ children }: { children: React.ReactNode }) {
  const { pendingPath } = useNavigationProgress()

  if (pendingPath) {
    const sectionName = SECTION_NAMES[pendingPath] || ""
    return (
      <>
        <SiteHeader sectionName={sectionName}>
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col bg-background rounded-t-xl" />
      </>
    )
  }

  return <>{children}</>
}
