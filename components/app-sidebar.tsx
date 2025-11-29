"use client"

import * as React from "react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  BarChartIcon,
  ClipboardListIcon,
  FileIcon,
  FileTextIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  ListIcon,
  SettingsIcon,
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
  const { theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Dynamically set isActive based on current pathname
  const navMainWithActive = navItems.map((item) => ({
    ...item,
    isActive: pathname === item.url,
  }))

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Determine which logo to show based on resolved theme
  const logoSrc = mounted && (resolvedTheme === 'dark' || theme === 'dark')
    ? '/logos/jetpack-light.svg'
    : '/logos/jetpack-dark.svg'

  // Adjust for different viewBox dimensions until SVGs are normalized
  const isDarkMode = resolvedTheme === 'dark' || theme === 'dark'
  const logoHeight = isDarkMode ? 26 : 24
  const logoWidth = isDarkMode ? 97 : 96

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
                {mounted && (
                  <Image
                    src={logoSrc}
                    alt="Jetpack"
                    width={logoWidth}
                    height={logoHeight}
                    className={isDarkMode ? "h-[26px] w-[97px] -ml-[3px]" : "h-6 w-24 -ml-[3px]"}
                    priority
                  />
                )}
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
