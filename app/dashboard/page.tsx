import { createClient } from "@/lib/supabase/server"
import { DashboardContent } from "@/components/dashboard-content"

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Extract first name from email or use email prefix
  const displayName = user?.user_metadata?.full_name?.split(' ')[0]
    || user?.email?.split('@')[0]
    || 'User'

  return (
    <DashboardContent displayName={displayName} />
  )
}
