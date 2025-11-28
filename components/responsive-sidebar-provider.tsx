"use client"

import { SidebarProvider } from "@/components/ui/sidebar"
import { useEffect, useState } from "react"

const SIDEBAR_BREAKPOINT = 1280

export function ResponsiveSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    // Set initial sidebar state based on window width
    const isDesktop = window.innerWidth >= SIDEBAR_BREAKPOINT
    setOpen(isDesktop)

    // Handle window resize to automatically collapse/expand sidebar
    const handleResize = () => {
      const isDesktop = window.innerWidth >= SIDEBAR_BREAKPOINT
      setOpen(isDesktop)
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      {children}
    </SidebarProvider>
  )
}
