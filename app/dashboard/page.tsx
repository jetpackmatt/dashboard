import { createClient } from "@/lib/supabase/server"
import { SiteHeader } from "@/components/site-header"
import { DashboardContent } from "@/components/dashboard-content"

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Extract first name from email or use email prefix
  const displayName = user?.user_metadata?.full_name?.split(' ')[0]
    || user?.email?.split('@')[0]
    || 'User'

  return (
    <>
      <SiteHeader sectionName={`Welcome Back, ${displayName}`} />
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <DashboardContent />
        </div>
      </div>
    </>
  )
}
