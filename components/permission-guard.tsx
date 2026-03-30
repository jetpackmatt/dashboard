'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useClient } from '@/components/client-context'

/**
 * Wraps page content and redirects brand users who lack the required permission.
 * Internal users (admin/care) always pass through.
 * Shows nothing while loading to prevent flash of forbidden content.
 */
export function PermissionGuard({
  permission,
  children,
}: {
  permission: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const { isLoading, hasPermission, isBrandUser } = useClient()

  const allowed = !isBrandUser || hasPermission(permission)

  useEffect(() => {
    if (!isLoading && !allowed) {
      router.replace('/dashboard')
    }
  }, [isLoading, allowed, router])

  if (isLoading || !allowed) return null

  return <>{children}</>
}
