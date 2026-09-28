'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'

interface OnboardingNavProps {
  onLogout: () => void
}

export function OnboardingNav({ onLogout }: OnboardingNavProps) {
  return (
    <nav className="bg-black/60 backdrop-blur-xs border-b border-(--card-border) sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Link
              href="/onboarding/dashboard"
              className="flex items-center gap-2"
            >
              <AnalyticsIcon className="w-8 h-8 text-(--primary)" />
              <span className="text-lg font-semibold text-primary-wh40k">
                Tacticus Analytics
              </span>
            </Link>
            <span className="hidden sm:inline text-sm text-secondary-wh40k">
              Finish onboarding to unlock the analytics dashboard.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/explore"
              className="text-primary-wh40k hover:text-(--primary) px-3 py-2 rounded-md text-sm font-medium transition-all duration-200"
            >
              Explore
            </Link>
            <Link
              href="/onboarding/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-accent-wh40k px-3 py-2 text-sm font-medium text-(--bg-primary) hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] transition-colors"
            >
              Continue Onboarding
              <ChevronRight className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="text-sm text-secondary-wh40k hover:text-primary-wh40k"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
