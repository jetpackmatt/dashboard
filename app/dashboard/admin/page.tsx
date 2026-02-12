import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
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
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <Suspense fallback={null}>
            <AdminContent />
          </Suspense>
        </div>
      </div>
    </>
  )
}
