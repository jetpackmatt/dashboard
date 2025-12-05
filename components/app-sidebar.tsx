"use client"

import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  BarChartIcon,
  ClipboardListIcon,
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

const navItems = [
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
    title: "Billing",
    url: "/dashboard/billing",
    icon: FileTextIcon,
  },
  {
    title: "Care Central",
    url: "/dashboard/care",
    icon: HelpCircleIcon,
  },
]

const data = {
  user: {
    name: "User",
    email: "user@example.com",
    avatar: "/avatars/default.jpg",
  },
  navSecondary: [
    {
      title: "Submit a Claim",
      url: "#",
      icon: ClipboardListIcon,
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
  ],
  documents: [],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { isAdmin } = useClient()

  // Admin-only nav item
  const adminNavItem = {
    title: "Admin",
    url: "/dashboard/admin",
    icon: ShieldIcon,
  }

  // Combine nav items - add Admin if user is admin
  const allNavItems = isAdmin ? [...navItems, adminNavItem] : navItems

  // Dynamically set isActive based on current pathname
  const navMainWithActive = allNavItems.map((item) => ({
    ...item,
    isActive: pathname === item.url || pathname.startsWith(item.url + '/'),
  }))

  return (
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
                  width={96}
                  height={24}
                  className="h-6 w-24 -ml-[3px] dark:hidden"
                  priority
                />
                <Image
                  src="/logos/jetpack-light.svg"
                  alt="Jetpack"
                  width={97}
                  height={26}
                  className="h-[26px] w-[97px] -ml-[3px] hidden dark:block"
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
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
