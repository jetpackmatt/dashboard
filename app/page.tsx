import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Prevent static generation - requires Supabase env vars at runtime
export const dynamic = 'force-dynamic'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
