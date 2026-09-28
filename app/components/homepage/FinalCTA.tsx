'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface FinalCTAProps {
  isAuthenticated: boolean
}

export function FinalCTA({ isAuthenticated: initialAuth }: FinalCTAProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(initialAuth)

  // Keep client state in sync with the server render.
  useEffect(() => {
    setIsAuthenticated(initialAuth)
  }, [initialAuth])

  return (
    <div className="py-20 bg-linear-to-r from-[color-mix(in_srgb,var(--primary)_20%,transparent)] via-(--bg-from) to-[color-mix(in_srgb,var(--primary)_20%,transparent)]">
      <div className="max-w-4xl mx-auto text-center px-4">
        <h2 className="text-4xl md:text-5xl font-bold text-primary-wh40k mb-4">
          {isAuthenticated
            ? 'Explore Your Guild Performance'
            : 'Ready to Track Your Guild Raids?'}
        </h2>
        <p className="text-xl text-secondary-wh40k mb-8">
          {isAuthenticated
            ? 'Open synced damage, token, and roster views'
            : 'Use live raid data to compare players, bosses, and cluster performance'}
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          {isAuthenticated ? (
            <>
              <Link
                href="/dashboard"
                className="px-8 py-4 bg-linear-to-r from-(--primary) to-(--accent) hover:from-(--accent) hover:to-(--primary) text-black font-bold rounded-lg text-lg transition-all duration-300 hover:shadow-lg hover:shadow-[color-mix(in_srgb,var(--accent)_25%,transparent)] hover:scale-105"
              >
                View Dashboard
              </Link>
              <Link
                href="/player-stats"
                className="px-8 py-4 bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] backdrop-blur-sm border border-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] text-primary-wh40k font-bold rounded-lg text-lg transition-all duration-300"
              >
                Player Stats
              </Link>
            </>
          ) : (
            <Link
              href="/auth/signup"
              className="px-8 py-4 bg-linear-to-r from-(--primary) to-(--accent) hover:from-(--accent) hover:to-(--primary) text-black font-bold rounded-lg text-lg transition-all duration-300 hover:shadow-lg hover:shadow-[color-mix(in_srgb,var(--accent)_25%,transparent)] hover:scale-105"
            >
              Sign Up Free →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
