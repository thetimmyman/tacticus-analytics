'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'

const FeatureHighlightsWithImages = dynamic(
  () =>
    import('@/app/components/homepage/FeatureHighlightsWithImages').then(
      (mod) => mod.FeatureHighlightsWithImages
    ),
  {
    ssr: false,
    loading: () => (
      <div className="py-16 bg-gradient-to-b from-[var(--bg-from)] via-gray-900 to-[var(--bg-to)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-12 w-64 rounded-xl bg-white/5 animate-pulse mx-auto" />
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {['a', 'b', 'c', 'd'].map((id) => (
              <div
                key={`skeleton-feature-${id}`}
                className="rounded-2xl border border-white/5 bg-white/5 h-32 animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }
)

const GlobalLeaderboard = dynamic(
  () =>
    import('@/app/components/homepage/GlobalLeaderboard').then(
      (mod) => mod.GlobalLeaderboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="py-16 bg-[color-mix(in_srgb,var(--bg-from)_50%,transparent)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-3">
            {['a', 'b', 'c', 'd', 'e'].map((id) => (
              <div
                key={`skeleton-leaderboard-${id}`}
                className="h-12 rounded-lg bg-white/5 animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }
)

const ContentCreators = dynamic(
  () =>
    import('@/app/components/homepage/ContentCreators').then(
      (mod) => mod.ContentCreators
    ),
  {
    ssr: false,
    loading: () => (
      <div className="py-16 bg-gradient-to-b from-[var(--bg-from)] to-[var(--bg-via)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((id) => (
            <div
              key={`skeleton-creator-${id}`}
              className="h-28 rounded-xl bg-white/5 animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }
)

export function MarketingDeferredSections() {
  return (
    <>
      <FeatureHighlightsWithImages />
      <div className="py-16 bg-[color-mix(in_srgb,var(--bg-from)_50%,transparent)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              Live Global Rankings
            </h2>
            <p className="text-[var(--text-secondary)] text-lg">
              Track performance across all clusters and guilds
            </p>
          </div>
          <GlobalLeaderboard />
          <div className="text-center mt-8">
            <Link
              href="/explore"
              className="inline-flex items-center px-6 py-3 bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] backdrop-blur border border-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-primary)_20%,transparent)] text-[var(--text-primary)] font-semibold rounded-lg transition-all duration-300"
            >
              View All Rankings →
            </Link>
          </div>
        </div>
      </div>
      <ContentCreators />
    </>
  )
}
