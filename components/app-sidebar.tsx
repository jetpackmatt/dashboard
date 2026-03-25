"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChartIcon,
  BinocularsIcon,
  ClipboardListIcon,
  DollarSignIcon,
  FileIcon,
  FileTextIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  ListIcon,
  PuzzleIcon,
  SettingsIcon,
  ShieldIcon,
} from "lucide-react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useClient } from "@/components/client-context"
import { ClaimSubmissionDialog } from "@/components/claims/claim-submission-dialog"

// Base nav items visible to all users
const baseNavItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboardIcon,
  },
  {
    title: "Transactions",
    url: "/dashboard/transactions",
    icon: ListIcon,
    defaultTab: "shipments",
    items: [
      { title: "Unfulfilled", value: "unfulfilled" },
      { title: "Shipments", value: "shipments" },
      { title: "Additional Services", value: "additional-services" },
      { title: "Returns", value: "returns" },
      { title: "Receiving", value: "receiving" },
      { title: "Storage", value: "storage" },
      { title: "Credits", value: "credits" },
    ],
  },
  {
    title: "Analytics",
    url: "/dashboard/analytics",
    icon: BarChartIcon,
    items: [
      { title: "Performance", value: "state-performance" },
      { title: "Cost + Speed", value: "cost-speed" },
      { title: "Order Volume", value: "order-volume" },
      { title: "Carriers", value: "carriers-zones" },
      { title: "Financials", value: "financials" },
      { title: "Fulfillment", value: "sla" },
    ],
  },
  {
    title: "Delivery IQ",
    url: "/dashboard/deliveryiq",
    icon: BinocularsIcon,
    badge: "Beta",
  },
  {
    title: "Invoices",
    url: "/dashboard/invoices",
    icon: FileIcon,
  },
  {
    title: "Jetpack Care",
    url: "/dashboard/care",
    icon: HelpCircleIcon,
  },
]

// Client-only nav items (hidden from admins)
const clientOnlyNavItems = [
  {
    title: "Billing",
    url: "/dashboard/billing",
    icon: FileTextIcon,
  },
]

const data = {
  documents: [],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { effectiveIsAdmin, effectiveIsCareUser, effectiveIsCareAdmin } = useClient()
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)
  const [hasCommission, setHasCommission] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [userData, setUserData] = React.useState({
    name: "",
    email: "",
    avatar: "",
  })

  // Track mount state to avoid hydration mismatch on role-dependent nav items
  React.useEffect(() => { setMounted(true) }, [])

  // Fetch user profile data
  React.useEffect(() => {
    async function fetchProfile() {
      try {
        const response = await fetch('/api/auth/profile')
        if (response.ok) {
          const data = await response.json()
          setUserData({
            name: data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || "",
            email: data.user?.email || "",
            avatar: data.user?.user_metadata?.avatar_url || "",
          })
        }
      } catch {
        // Silently fail - will show empty user info
      }
    }
    fetchProfile()
  }, [])

  // Check if user has a commission assignment (for Financials nav visibility)
  React.useEffect(() => {
    async function checkCommission() {
      try {
        const response = await fetch('/api/data/commissions')
        if (response.ok) {
          const data = await response.json()
          // User has commission if data.data is not null
          setHasCommission(data.success && data.data !== null)
        }
      } catch {
        // Silently fail - user just won't see the nav item
      }
    }
    checkCommission()
  }, [])

  // Financials nav item (visible to users with commission OR admins)
  const financialsNavItem = {
    title: "Financials",
    url: "/dashboard/financials",
    icon: DollarSignIcon,
  }

  // Admin-only nav item
  const adminNavItem = {
    title: "Admin",
    url: "/dashboard/admin",
    icon: ShieldIcon,
    items: [
      { title: "Markups", value: "markup" },
      { title: "Invoicing", value: "invoicing" },
      { title: "Brands", value: "brands" },
      { title: "Disputes", value: "disputes" },
      { title: "Orphans", value: "orphans" },
      { title: "Sync Health", value: "sync-health" },
      { title: "Warehouses", value: "warehouses" },
      { title: "Care Team", value: "care-team" },
      { title: "Commissions", value: "commissions" },
      { title: "Delivery IQ", value: "delivery-iq" },
    ],
  }

  // Build nav items based on user role
  // Only add role-dependent items after mount to prevent hydration mismatch
  // (effectiveIsAdmin/hasCommission are false during SSR but change on client)
  let allNavItems = [...baseNavItems]

  if (mounted) {
    // Add Misfits between Invoices and Jetpack Care (admin + care admin only)
    if (effectiveIsAdmin || effectiveIsCareAdmin) {
      const careIndex = allNavItems.findIndex(item => item.url === '/dashboard/care')
      if (careIndex >= 0) {
        allNavItems.splice(careIndex, 0, {
          title: "Misfits",
          url: "/dashboard/misfits",
          icon: PuzzleIcon,
        })
      }
    }

    // Add Financials if user has commission assignment OR is admin
    if (hasCommission || effectiveIsAdmin) {
      allNavItems.push(financialsNavItem)
    }

    if (effectiveIsAdmin) {
      allNavItems.push(adminNavItem)
    } else if (!effectiveIsCareUser) {
      // Regular clients get Billing
      allNavItems = [...allNavItems, ...clientOnlyNavItems]
    }
  }

  // Dynamically set isActive based on current pathname
  const navMainWithActive = allNavItems.map((item) => ({
    ...item,
    isActive: item.url === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === item.url || pathname.startsWith(item.url + '/'),
  }))

  // Build navSecondary items with onClick handler for Submit a Claim
  const navSecondaryItems = [
    {
      title: "Submit a Claim",
      url: "#",
      icon: ClipboardListIcon,
      onClick: () => setClaimDialogOpen(true),
    },
    {
      title: "Settings",
      url: "/dashboard/settings",
      icon: SettingsIcon,
    },
    {
      title: "Help",
      url: "https://help.jetpack3pl.com",
      icon: HelpCircleIcon,
      external: true,
    },
  ]

  return (
    <>
      <Sidebar collapsible="offcanvas" {...props}>
        <SidebarHeader>
          <Link href="/dashboard" prefetch={false} className="flex items-center px-2 py-1 transition-[filter] hover:brightness-75">
            <Image
              src="/logos/jetpack-dark.svg"
              alt="Jetpack"
              width={120}
              height={30}
              className="h-[30px] w-[120px] dark:hidden"
              priority
            />
            <Image
              src="/logos/jetpack-light.svg"
              alt="Jetpack"
              width={121}
              height={33}
              className="h-[33px] w-[121px] hidden dark:block"
              priority
            />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={navMainWithActive} />
          {data.documents.length > 0 && <NavDocuments items={data.documents} />}
          <NavSecondary items={navSecondaryItems} className="mt-auto" />
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={userData} />
        </SidebarFooter>
      </Sidebar>

      <ClaimSubmissionDialog
        open={claimDialogOpen}
        onOpenChange={setClaimDialogOpen}
      />
    </>
  )
}
