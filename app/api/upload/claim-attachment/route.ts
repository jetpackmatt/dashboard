import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]

/**
 * POST /api/upload/claim-attachment
 *
 * Upload a file attachment for a claim.
 * Files are stored in Supabase Storage in the 'claim-attachments' bucket.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Parse the form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF' },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size: 10MB' },
        { status: 400 }
      )
    }

    // Generate a unique filename
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(2, 8)
    const extension = file.name.split('.').pop() || 'bin'
    const sanitizedName = file.name
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .substring(0, 50)
    const filename = `${user.id}/${timestamp}-${randomStr}-${sanitizedName}`

    // Upload to Supabase Storage
    const supabase = createAdminClient()
    const buffer = await file.arrayBuffer()

    const { data, error: uploadError } = await supabase.storage
      .from('claim-attachments')
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      )
    }

    // Get the public URL (or signed URL if bucket is private)
    const { data: urlData } = supabase.storage
      .from('claim-attachments')
      .getPublicUrl(data.path)

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      path: data.path,
    })
  } catch (err) {
    console.error('Claim attachment upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
