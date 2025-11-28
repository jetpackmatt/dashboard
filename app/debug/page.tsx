import { createClient } from '@/lib/supabase/server'

export default async function DebugPage() {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  const { data: { session } } = await supabase.auth.getSession()

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold mb-6">Debug Information</h1>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">User Status:</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto">
              {user ? JSON.stringify(user, null, 2) : 'No user logged in'}
            </pre>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">Session Status:</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto">
              {session ? JSON.stringify(session, null, 2) : 'No active session'}
            </pre>
          </div>

          {error && (
            <div>
              <h2 className="text-xl font-semibold mb-2 text-red-600">Error:</h2>
              <pre className="bg-red-50 p-4 rounded overflow-auto">
                {JSON.stringify(error, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <h2 className="text-xl font-semibold mb-2">Environment Variables:</h2>
            <pre className="bg-gray-50 p-4 rounded overflow-auto">
              SUPABASE_URL: {process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing'}
              {'\n'}SUPABASE_ANON_KEY: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
