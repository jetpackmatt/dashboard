import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { Resend } from 'resend'

/**
 * POST /api/data/brand_team/resend-invite
 *
 * Resend setup email for a team member.
 * Works for both unconfirmed (invite) and confirmed (magiclink) users.
 * Only brand_owner (or admin) can resend.
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))

    if (!access.isAdmin && !access.isCareUser && access.brandRole !== 'brand_owner') {
      return NextResponse.json({ error: 'Only brand owners can resend invites' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  try {
    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Get user details
    const { data: { user }, error: userError } = await admin.auth.admin.getUserById(userId)
    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const isConfirmed = !!user.email_confirmed_at

    // For unconfirmed users: generate invite link
    // For confirmed users (clicked old broken link but never set password): use magiclink
    const linkType = isConfirmed ? 'magiclink' : 'invite'
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: linkType,
      email: user.email!,
      options: {
        redirectTo: `${baseUrl}/auth/callback?next=/accept-invite`,
      },
    })

    if (linkError || !linkData) {
      console.error('Failed to generate invite link:', linkError)
      return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 })
    }

    // Use hashed_token directly in our callback URL (bypasses Supabase PKCE redirect).
    // The action_link goes through Supabase's server which redirects with a PKCE code,
    // but since the flow wasn't initiated from the browser, there's no code_verifier cookie,
    // so the code exchange fails. Using token_hash + verifyOtp works reliably.
    const inviteLink = `${baseUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=${linkType}&next=/accept-invite`
    const userName = user.user_metadata?.full_name || ''

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error: emailError } = await resend.emails.send({
      from: 'Jetpack <support@shipwithjetpack.com>',
      to: [user.email!],
      subject: 'You\'ve been invited to Jetpack Pro',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111827; font-size: 24px; margin-bottom: 8px;">Welcome to Jetpack Pro</h2>
          <p style="color: #6b7280; font-size: 16px; line-height: 1.5;">
            ${userName ? `Hi ${userName}, you` : 'You'}'ve been invited to join Jetpack Pro. Click the button below to set up your account.
          </p>
          <div style="margin: 32px 0;">
            <a href="${inviteLink}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
              Accept Invitation
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 13px; line-height: 1.5;">
            This link will expire in 24 hours. If you didn't expect this invitation, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `You've been invited to Jetpack Pro. Accept your invitation: ${inviteLink}`,
    })

    if (emailError) {
      console.error('Failed to send invite email:', emailError)
      return NextResponse.json({ error: 'Failed to send invite email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error resending invite:', error)
    return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 })
  }
}
