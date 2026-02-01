import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Site password protection - set SITE_PASSWORD env var to enable
const SITE_PASSWORD = process.env.SITE_PASSWORD

export async function middleware(request: NextRequest) {
  // Skip if env vars are missing (during build)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }

  // Password protection gate (only if SITE_PASSWORD is set)
  if (SITE_PASSWORD) {
    const pathname = request.nextUrl.pathname
    const isPasswordPage = pathname === '/password'
    const isPasswordApi = pathname === '/api/password'
    const isCronApi = pathname.startsWith('/api/cron/')
    const isWebhookApi = pathname.startsWith('/api/webhooks/')
    const isAuthCallback = pathname.startsWith('/auth/callback')
    const isPublicMarketing = pathname === '/about-delivery-iq'
    const hasAccess = request.cookies.get('site_access')?.value === 'granted'

    // Skip password for cron jobs, webhooks, auth callbacks, and public marketing pages
    if (!hasAccess && !isPasswordPage && !isPasswordApi && !isCronApi && !isWebhookApi && !isAuthCallback && !isPublicMarketing) {
      return NextResponse.redirect(new URL('/password', request.url))
    }
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshing the auth token
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
