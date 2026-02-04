"use client"

import * as React from "react"
import Image from "next/image"
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
  },
  {
    title: "Delivery IQ",
    url: "/dashboard/lookout",
    icon: BinocularsIcon,
  },
  {
    title: "Analytics",
    url: "/dashboard/analytics",
    icon: BarChartIcon,
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
  user: {
    name: "User",
    email: "user@example.com",
    avatar: "/avatars/default.jpg",
  },
  documents: [],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { effectiveIsAdmin, effectiveIsCareUser } = useClient()
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)
  const [hasCommission, setHasCommission] = React.useState(false)

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
  }

  // Build nav items based on user role
  // - Admins: base items + Financials (always) + Admin
  // - Care users: base items + Financials (if assigned)
  // - Clients: base items + Financials (if assigned) + Billing
  let allNavItems = [...baseNavItems]

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

  // Dynamically set isActive based on current pathname
  const navMainWithActive = allNavItems.map((item) => ({
    ...item,
    isActive: pathname === item.url || pathname.startsWith(item.url + '/'),
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
      url: "#",
      icon: HelpCircleIcon,
    },
  ]

  return (
    <>
      <Sidebar collapsible="offcanvas" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="data-[slot=sidebar-menu-button]:!p-1.5"
              >
                <a href="/dashboard" className="flex items-center gap-2">
                  {/* Render both logos, use CSS to show correct one based on theme class - no flash */}
                  <Image
                    src="/logos/jetpack-dark.svg"
                    alt="Jetpack"
                    width={120}
                    height={30}
                    className="h-[30px] w-[120px] -ml-[3px] dark:hidden"
                    priority
                  />
                  <Image
                    src="/logos/jetpack-light.svg"
                    alt="Jetpack"
                    width={121}
                    height={33}
                    className="h-[33px] w-[121px] -ml-[3px] hidden dark:block"
                    priority
                  />
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={navMainWithActive} />
          {data.documents.length > 0 && <NavDocuments items={data.documents} />}
          <NavSecondary items={navSecondaryItems} className="mt-auto" />
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={data.user} />
        </SidebarFooter>
      </Sidebar>

      <ClaimSubmissionDialog
        open={claimDialogOpen}
        onOpenChange={setClaimDialogOpen}
      />
    </>
  )
}
