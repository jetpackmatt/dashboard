import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppSidebar } from "@/components/app-sidebar"
import { ResponsiveSidebarProvider } from "@/components/responsive-sidebar-provider"
import { SidebarInset } from "@/components/ui/sidebar"
import { ClientProvider } from "@/components/client-context"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <ClientProvider>
      <ResponsiveSidebarProvider>
        <AppSidebar variant="inset" />
        <SidebarInset>
          {children}
        </SidebarInset>
      </ResponsiveSidebarProvider>
    </ClientProvider>
  )
}
