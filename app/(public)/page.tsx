import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { getLiveStats } from '@/app/lib/data/get-live-stats'
import { LiveStatsSection } from '@/app/components/homepage/LiveStatsSection'
import { HeroCTA } from '@/app/components/homepage/HeroCTA'
import { FinalCTA } from '@/app/components/homepage/FinalCTA'
import { MarketingDeferredSections } from '@/app/components/homepage/MarketingDeferredSections'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Guild Raid Analytics for Tacticus',
  description:
    'Track guild raid tokens, battle performance, leaderboards, and meta teams for Warhammer 40,000: Tacticus.',
  path: '/'
})

// Zeros make LiveStatsSection show its static snapshot numbers while streaming.
const PLACEHOLDER_STATS = {
  activePlayers: 0,
  battlesTracked: 0,
  guilds: 0,
  totalDamage: 0
}

async function LiveStatsLoader() {
  const liveStats = await getLiveStats()
  return <LiveStatsSection initialStats={liveStats} />
}

export default async function HomePage() {
  const authData = await getAuthUser()

  // Matches authConfig.redirects.afterLogin.
  if (authData?.user) {
    redirect('/home')
  }

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-b from-[var(--bg-from)] via-[var(--bg-via)] to-[var(--bg-to)]">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"></div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center">
            {/* Animated Logo */}
            <div className="relative mb-8">
              <div className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] blur-3xl"></div>
              <div className="relative w-32 h-32 mx-auto bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] rounded-full flex items-center justify-center border-2 border-[color-mix(in_srgb,var(--accent)_50%,transparent)] shadow-2xl animate-pulse">
                <AnalyticsIcon className="w-20 h-20 text-[var(--bg-from)]" />
              </div>
            </div>

            <h1 className="text-5xl md:text-7xl font-black mb-4 bg-gradient-to-r from-[var(--text-primary)] via-[var(--accent)] to-[var(--text-primary)] bg-clip-text text-transparent tracking-tight">
              Tacticus Analytics
            </h1>

            <p className="text-xl md:text-2xl text-[var(--text-secondary)] mb-8 font-light max-w-3xl mx-auto">
              Guild raid dashboards for Warhammer 40,000: Tacticus officers:
              live API sync, boss performance, token availability, and cluster
              rankings in one place
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {[
                'Real-time Tracking',
                '90+ Metrics',
                'Discord Integration',
                'Cluster Support'
              ].map((feature) => (
                <span
                  key={feature}
                  className="px-3 py-1 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-full text-sm text-[var(--accent)]"
                >
                  {feature}
                </span>
              ))}
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <HeroCTA isAuthenticated={!!authData?.user} />
            </div>
          </div>
        </div>
      </div>

      {/* Streamed so the slow stats query does not block first paint */}
      <Suspense
        fallback={<LiveStatsSection initialStats={PLACEHOLDER_STATS} />}
      >
        <LiveStatsLoader />
      </Suspense>

      <MarketingDeferredSections />

      {/* Final CTA Section */}
      <FinalCTA isAuthenticated={!!authData?.user} />
    </div>
  )
}
