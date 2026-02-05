import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * POST /api/auth/avatar
 * Upload user avatar image
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('avatar') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.' },
        { status: 400 }
      )
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      )
    }

    // Create admin client for storage operations
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Ensure avatars bucket exists
    const { data: buckets } = await adminSupabase.storage.listBuckets()
    const avatarsBucketExists = buckets?.some(b => b.name === 'avatars')

    if (!avatarsBucketExists) {
      const { error: createBucketError } = await adminSupabase.storage.createBucket('avatars', {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      })

      if (createBucketError) {
        console.error('Error creating avatars bucket:', createBucketError)
        return NextResponse.json(
          { error: 'Storage not configured. Please contact support.' },
          { status: 500 }
        )
      }
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop() || 'jpg'
    const fileName = `${user.id}-${Date.now()}.${fileExt}`

    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage (file path is relative to bucket)
    const { error: uploadError } = await adminSupabase.storage
      .from('avatars')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Error uploading avatar:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload avatar' },
        { status: 500 }
      )
    }

    // Get public URL
    const { data: urlData } = adminSupabase.storage
      .from('avatars')
      .getPublicUrl(fileName)

    const avatarUrl = urlData.publicUrl

    // Update user metadata with new avatar URL
    const { error: updateError } = await supabase.auth.updateUser({
      data: { avatar_url: avatarUrl },
    })

    if (updateError) {
      console.error('Error updating user metadata:', updateError)
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      )
    }

    // Delete old avatar if exists (clean up storage)
    const oldAvatarUrl = user.user_metadata?.avatar_url
    if (oldAvatarUrl && oldAvatarUrl.includes('/avatars/')) {
      // Extract just the filename from the URL
      const urlParts = oldAvatarUrl.split('/avatars/')
      const oldFileName = urlParts[urlParts.length - 1]
      if (oldFileName && oldFileName !== fileName) {
        await adminSupabase.storage
          .from('avatars')
          .remove([oldFileName])
          .catch(() => {
            // Silently ignore cleanup errors
          })
      }
    }

    return NextResponse.json({ avatarUrl })
  } catch (error) {
    console.error('Error uploading avatar:', error)
    return NextResponse.json(
      { error: 'Failed to upload avatar' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/auth/avatar
 * Remove user avatar
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Create admin client for storage operations
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Delete avatar from storage if exists
    const avatarUrl = user.user_metadata?.avatar_url
    if (avatarUrl && avatarUrl.includes('/avatars/')) {
      // Extract just the filename from the URL
      const urlParts = avatarUrl.split('/avatars/')
      const fileName = urlParts[urlParts.length - 1]
      if (fileName) {
        await adminSupabase.storage
          .from('avatars')
          .remove([fileName])
          .catch(() => {
            // Silently ignore cleanup errors
          })
      }
    }

    // Clear avatar_url from user metadata
    const { error: updateError } = await supabase.auth.updateUser({
      data: { avatar_url: null },
    })

    if (updateError) {
      console.error('Error updating user metadata:', updateError)
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing avatar:', error)
    return NextResponse.json(
      { error: 'Failed to remove avatar' },
      { status: 500 }
    )
  }
}
