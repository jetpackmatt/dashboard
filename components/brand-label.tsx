'use client'

import * as React from 'react'
import { useClient } from '@/components/client-context'

export function BrandLabel() {
  const { isAdmin, isCareUser, isLoading } = useClient()
  const [companyName, setCompanyName] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (isLoading || isAdmin || isCareUser) return

    fetch('/api/data/user/brand')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.companyName) setCompanyName(data.companyName)
      })
      .catch(() => { /* brand label is non-critical — fail silently */ })
  }, [isLoading, isAdmin, isCareUser])

  if (isLoading || isAdmin || isCareUser || !companyName) return null

  return (
    <span className="text-sm font-semibold">{companyName}</span>
  )
}
