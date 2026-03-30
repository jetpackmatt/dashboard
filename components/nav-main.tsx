"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { type LucideIcon } from "lucide-react"
import { useNavigationProgress } from "@/components/navigation-progress"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"

interface SubItem {
  title: string
  value: string
  icon?: LucideIcon
}

interface NavItem {
  title: string
  url: string
  icon?: LucideIcon
  isActive?: boolean
  items?: SubItem[]
  defaultTab?: string
  badge?: string
}

export function NavMain({
  items,
}: {
  items: NavItem[]
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { startNavigation, pendingPath } = useNavigationProgress()

  // Determine active state: use pendingPath for instant feedback, fall back to pathname-based isActive
  const getIsActive = (item: NavItem) => {
    if (pendingPath) {
      if (item.url === '/dashboard') return pendingPath === '/dashboard'
      return pendingPath === item.url || pendingPath.startsWith(item.url + '/')
    }
    return item.isActive
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = getIsActive(item)
            return item.items ? (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                  <Link
                    href={`${item.url}?tab=${item.defaultTab || item.items[0].value}`}
                    prefetch={true}
                    onClick={() => startNavigation(item.url)}
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: isActive ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <SidebarMenuSub>
                      {item.items.map((subItem) => {
                        const currentTab = searchParams.get('tab')
                        const isSubActive = isActive && (currentTab === subItem.value || (!currentTab && subItem === item.items![0]))
                        return (
                          <SidebarMenuSubItem key={subItem.value}>
                            <SidebarMenuSubButton asChild isActive={isSubActive} size="sm">
                              <Link
                                href={`${item.url}?tab=${subItem.value}`}
                                prefetch={true}
                                onClick={() => startNavigation(item.url)}
                              >
                                <span>{subItem.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  </div>
                </div>
              </SidebarMenuItem>
            ) : (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                  <Link
                    href={item.url}
                    prefetch={true}
                    onClick={() => startNavigation(item.url)}
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    {item.badge && (
                      <span className="text-[8px] font-semibold uppercase tracking-wide px-[3px] py-0 leading-[14px] rounded-sm bg-[#c9dafa] text-blue-600 dark:bg-blue-900 dark:text-blue-400">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
