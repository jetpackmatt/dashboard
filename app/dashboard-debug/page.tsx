import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

// Prevent static generation - requires Supabase env vars at runtime
export const dynamic = 'force-dynamic'

export default async function DebugPage() {
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  const { data: { session } } = await supabase.auth.getSession()

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold mb-6">Server-Side Debug</h1>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">All Cookies Received:</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto text-xs">
              {allCookies.length === 0 ? 'No cookies found' : JSON.stringify(allCookies, null, 2)}
            </pre>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">Supabase Cookies:</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto text-xs">
              {JSON.stringify(
                allCookies.filter(c => c.name.includes('sb-')),
                null,
                2
              )}
            </pre>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">User from getUser():</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto text-xs">
              {user ? JSON.stringify(user, null, 2) : 'No user'}
            </pre>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">Session from getSession():</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto text-xs">
              {session ? JSON.stringify(session, null, 2) : 'No session'}
            </pre>
          </div>

          {error && (
            <div>
              <h2 className="text-xl font-semibold mb-2 text-red-600">Error:</h2>
              <pre className="bg-red-50 p-4 rounded overflow-auto text-xs">
                {JSON.stringify(error, null, 2)}
              </pre>
            </div>
          )}

          <div className="pt-4">
            <a href="/login" className="text-indigo-600 hover:text-indigo-700 underline">
              ← Back to Login
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
