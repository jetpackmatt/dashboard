import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { AdminContent } from "@/components/admin-content"

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Check if user is admin
  if (user.user_metadata?.role !== 'admin') {
    redirect('/dashboard')
  }

  return (
    <>
      <SiteHeader sectionName="Admin" />
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <AdminContent />
        </div>
      </div>
    </>
  )
}
