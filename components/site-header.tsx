import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { ClientSelector } from "@/components/client-selector"

interface SiteHeaderProps {
  sectionName?: string
}

export function SiteHeader({ sectionName = "Dashboard" }: SiteHeaderProps) {
  return (
    <header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-12 shrink-0 items-center gap-2 border-b border-border transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{sectionName}</h1>
        <div className="ml-auto flex items-center gap-2">
          <ClientSelector />
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
