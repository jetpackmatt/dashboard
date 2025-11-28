import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const sitePassword = process.env.SITE_PASSWORD

  if (!sitePassword) {
    // No password set, allow access
    return NextResponse.json({ success: true })
  }

  if (password === sitePassword) {
    const response = NextResponse.json({ success: true })

    // Set cookie that expires in 30 days
    response.cookies.set('site_access', 'granted', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })

    return response
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
}
