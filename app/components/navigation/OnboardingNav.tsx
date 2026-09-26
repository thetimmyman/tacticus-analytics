'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'

interface OnboardingNavProps {
  onLogout: () => void
}

export function OnboardingNav({ onLogout }: OnboardingNavProps) {
  return (
    <nav className="bg-black/60 backdrop-blur-sm border-b border-[var(--card-border)] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Link
              href="/onboarding/dashboard"
              className="flex items-center gap-2"
            >
              <AnalyticsIcon className="w-8 h-8 text-[var(--primary)]" />
              <span className="text-lg font-semibold text-[var(--text-primary)]">
                Tacticus Analytics
              </span>
            </Link>
            <span className="hidden sm:inline text-sm text-[var(--text-secondary)]">
              Finish onboarding to unlock the analytics dashboard.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/explore"
              className="text-[var(--text-primary)] hover:text-[var(--primary)] px-3 py-2 rounded-md text-sm font-medium transition-all duration-200"
            >
              Explore
            </Link>
            <Link
              href="/onboarding/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--bg-primary)] hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] transition-colors"
            >
              Continue Onboarding
              <ChevronRight className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
