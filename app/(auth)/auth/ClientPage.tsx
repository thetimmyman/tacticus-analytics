'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'
import LoginForm from '@/app/components/auth/LoginForm'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import SimplifiedSignupForm from './signup/SimplifiedSignupForm'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  return (
    <div className="min-h-screen bg-linear-to-br from-(--bg-from) via-red-900 to-(--bg-to) flex items-center justify-center">
      <div className="max-w-md w-full mx-auto p-6">
        <div className="bg-black/60 backdrop-blur-xs rounded-lg border border-red-500/30 p-8">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block">
              <div className="relative mb-6 inline-block">
                <div className="absolute inset-0 rounded-full bg-red-500/20 blur-xl" />
                <div className="relative w-16 h-16 mx-auto bg-linear-to-br from-amber-400 to-red-600 rounded-full flex items-center justify-center border-2 border-amber-400/50 shadow-2xl">
                  <AnalyticsIcon className="w-8 h-8 text-(--bg-primary)" />
                </div>
              </div>
            </Link>
            <h1 className="text-2xl font-bold text-yellow-400">
              Tacticus Analytics
            </h1>
          </div>

          <div
            className="flex space-x-2 mb-6"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              aria-label="Show the login form"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                mode === 'login'
                  ? 'bg-amber-600 text-(--bg-primary)'
                  : 'bg-black/40 text-amber-100/80 hover:bg-black/60'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              aria-label="Switch to the create account tab"
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                mode === 'signup'
                  ? 'bg-amber-600 text-(--bg-primary)'
                  : 'bg-black/40 text-amber-100/80 hover:bg-black/60'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="auth-form-container">
            <Suspense
              fallback={
                <LoadingSpinner
                  message="Authenticating with the Omnissiah..."
                  variant="protocol"
                />
              }
            >
              {mode === 'login' ? <LoginForm /> : <SimplifiedSignupForm />}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
