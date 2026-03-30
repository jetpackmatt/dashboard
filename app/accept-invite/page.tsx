'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { JetpackLoader } from '@/components/jetpack-loader'

export default function AcceptInvitePage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [userName, setUserName] = useState<string | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function checkUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = '/login?error=invite_expired'
        return
      }
      setUserName(user.user_metadata?.full_name || user.email || '')
      setIsCheckingAuth(false)
    }
    checkUser()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to set password')
        setIsLoading(false)
        return
      }

      window.location.href = '/dashboard'
    } catch {
      setError('Network error. Please try again.')
      setIsLoading(false)
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <JetpackLoader size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="fixed inset-0 bg-[radial-gradient(hsl(var(--sidebar-border))_1px,transparent_1px)] [background-size:20px_20px] opacity-50" />

      <div className="relative max-w-[400px] w-full mx-4">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <Image
            src="/logos/jetpack-dark.svg"
            alt="Jetpack"
            width={160}
            height={40}
            className="h-[40px] w-auto dark:hidden"
            priority
          />
          <Image
            src="/logos/jetpack-light.svg"
            alt="Jetpack"
            width={160}
            height={40}
            className="h-[40px] w-auto hidden dark:block"
            priority
          />
        </div>

        {/* Card */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">
              Welcome{userName ? `, ${userName}` : ''}!
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Set a password to complete your account setup.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-foreground/70 mb-1.5 uppercase tracking-wider"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 px-3 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs font-medium text-foreground/70 mb-1.5 uppercase tracking-wider"
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-10 px-3 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                placeholder="Re-enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <><JetpackLoader size="sm" />Setting up...</>
              ) : (
                'Set Password & Continue'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground/60 mt-6">
          ©2026 Jetpack Ventures Inc.
        </p>
      </div>
    </div>
  )
}
