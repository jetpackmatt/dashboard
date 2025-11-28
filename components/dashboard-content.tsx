"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { motion } from "framer-motion"

import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"

interface Shipment {
  id: number
  status: string
  customerName: string
  orderType: string
  qty: number
  cost: number
  importDate: string
  slaDate: string
}

interface AdditionalService {
  id: number
  serviceId: string
  serviceType: string
  customerName: string
  status: string
  quantity: number
  cost: number
  requestDate: string
  completionDate: string
}

interface Return {
  id: number
  rmaNumber: string
  orderId: string
  customerName: string
  reason: string
  status: string
  itemsQty: number
  receivedDate: string
  resolutionDate: string
}

interface Receiving {
  id: number
  referenceId: string
  feeType: string
  cost: number
  transactionDate: string
}

interface Storage {
  id: number
  sku: string
  productName: string
  location: string
  qtyOnHand: number
  reserved: number
  available: number
  lastUpdated: string
}

interface Credit {
  id: number
  creditId: string
  customerName: string
  orderReference: string
  reason: string
  amount: number
  status: string
  issueDate: string
}

interface DashboardContentProps {
  shipmentsData: Shipment[]
  additionalServicesData: AdditionalService[]
  returnsData: Return[]
  receivingData: Receiving[]
  storageData: Storage[]
  creditsData: Credit[]
}

export function DashboardContent({
  shipmentsData,
  additionalServicesData,
  returnsData,
  receivingData,
  storageData,
  creditsData,
}: DashboardContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isNavigating, setIsNavigating] = React.useState(false)

  // Initialize fromShipments by reading sessionStorage synchronously
  const [fromShipments] = React.useState(() => {
    if (typeof window !== "undefined") {
      const navigationFlag = sessionStorage.getItem('navigatingFromShipments')
      if (navigationFlag === 'true') {
        // Clear the flag immediately after reading
        sessionStorage.removeItem('navigatingFromShipments')
        return true
      }
    }
    return false
  })

  // Listen for navigation to Shipments section
  React.useEffect(() => {
    // Intercept clicks on the Shipments link
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a[href="/dashboard/shipments"]')

      if (link && pathname === "/dashboard") {
        e.preventDefault()
        setIsNavigating(true)

        // Set flag for shipments page to detect navigation from dashboard
        sessionStorage.setItem('navigatingFromDashboard', 'true')

        // Navigate after fade-out animation
        setTimeout(() => {
          router.push("/dashboard/shipments")
        }, 300) // Match animation duration
      }
    }

    document.addEventListener("click", handleClick, true)

    return () => {
      document.removeEventListener("click", handleClick, true)
    }
  }, [pathname, router])

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full">
      <motion.div
        initial={fromShipments ? { opacity: 0, y: 20 } : false}
        animate={{
          opacity: isNavigating ? 0 : 1,
          y: isNavigating ? -20 : 0,
        }}
        transition={{
          duration: 0.3,
          ease: "easeOut",
        }}
      >
        <SectionCards />
      </motion.div>

      <motion.div
        className="px-4 lg:px-6"
        initial={fromShipments ? { opacity: 0, y: 20 } : false}
        animate={{
          opacity: isNavigating ? 0 : 1,
          y: isNavigating ? -20 : 0,
        }}
        transition={{
          duration: 0.3,
          ease: "easeOut",
          delay: fromShipments ? 0.1 : 0,
        }}
      >
        <ChartAreaInteractive />
      </motion.div>

      <DataTable
        shipmentsData={shipmentsData}
        additionalServicesData={additionalServicesData}
        returnsData={returnsData}
        receivingData={receivingData}
        storageData={storageData}
        creditsData={creditsData}
      />
    </div>
  )
}
