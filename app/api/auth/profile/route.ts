import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/auth/profile
 * Get current user's profile
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
        avatar_url: user.user_metadata?.avatar_url || null,
        created_at: user.created_at,
      },
    })
  } catch (error) {
    console.error('Error fetching profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/auth/profile
 * Update current user's profile
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { full_name, email } = body

    // Update user metadata (name)
    const updates: { data?: { full_name?: string }; email?: string } = {}

    if (full_name !== undefined) {
      updates.data = { full_name }
    }

    if (email && email !== user.email) {
      updates.email = email
    }

    const { data, error } = await supabase.auth.updateUser(updates)

    if (error) {
      console.error('Error updating profile:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to update profile' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        user_metadata: data.user.user_metadata,
      },
    })
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    )
  }
}
