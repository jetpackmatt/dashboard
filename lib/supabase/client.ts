import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // Use default cookie handling - it automatically manages cookies properly
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
