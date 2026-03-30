'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { JetpackLoader } from '@/components/jetpack-loader'

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
        setIsLoading(false)
      } else if (!data.session) {
        setError('Login succeeded but no session created.')
        setIsLoading(false)
      } else {
        window.location.href = '/dashboard'
      }
    } catch (err) {
      console.error('Auth error:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string

    if (!email) {
      setError('Please enter your email address')
      setIsLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/accept-invite`,
      })

      if (error) {
        setError(error.message)
      } else {
        setSuccess('Password reset link sent. Check your email.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      {/* Subtle background pattern */}
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
          {showForgotPassword ? (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-foreground">
                  Reset Password
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your email and we&apos;ll send a reset link.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {success && (
                <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg">
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">{success}</p>
                </div>
              )}

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label
                    htmlFor="reset-email"
                    className="block text-xs font-medium text-foreground/70 mb-1.5 uppercase tracking-wider"
                  >
                    Email Address
                  </label>
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    className="w-full h-10 px-3 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                    placeholder="you@company.com"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-10 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <><JetpackLoader size="sm" />Sending...</>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <button
                  onClick={() => {
                    setShowForgotPassword(false)
                    setError(null)
                    setSuccess(null)
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  Back to sign in
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-foreground">
                  Sign in
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your credentials to continue.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium text-foreground/70 mb-1.5 uppercase tracking-wider"
                  >
                    Email Address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    className="w-full h-10 px-3 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                    placeholder="you@company.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-xs font-medium text-foreground/70 mb-1.5 uppercase tracking-wider"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    className="w-full h-10 px-3 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-10 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <><JetpackLoader size="sm" />Signing in...</>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <button
                  onClick={() => {
                    setShowForgotPassword(true)
                    setError(null)
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  Forgot your password?
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/60 mt-6">
          ©2026 Jetpack Ventures Inc.
        </p>
      </div>
    </div>
  )
}
