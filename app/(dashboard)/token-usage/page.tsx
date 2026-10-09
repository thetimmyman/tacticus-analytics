import dynamicImport from 'next/dynamic'
import { createHash } from 'node:crypto'
import { requireRole } from '@/app/lib/auth'
import { getLatestSeason } from '@/app/lib/utils/season'
import { resolveEffectiveSeason } from '@/app/lib/season-date/precedence'
import { EmptyState } from '@tacticus/ui-kit'
import { createPageMetadata } from '@/app/lib/metadata'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

export const metadata = createPageMetadata({
  title: 'Token Usage',
  description:
    'Review guild raid token usage, battle timing, member availability, and season participation patterns.',
  path: '/token-usage'
})

const TokenUsage = dynamicImport(() => import('@/app/components/TokenUsage'), {
  loading: () => (
    <div className="p-6 text-secondary-wh40k">Loading token usage data...</div>
  )
})

interface PageProps {
  searchParams: Promise<{ guild?: string; season?: string }>
}

export default async function TokenUsagePage({ searchParams }: PageProps) {
  const authData = await requireRole('officer')
  const userGuild = authData.profile.guild_code

  const isDesktop = getRuntimeProfile() === 'desktop'
  // Saved outlook is a separate local calculation; full forecasts retain their entitlement.
  const showForecast =
    !isDesktop &&
    (await checkFeatureAccess(authData.user.id, 'proactive_token_management'))
      .has_access
  const savedOutlookContextKey = isDesktop
    ? createHash('sha256')
        .update(
          JSON.stringify([
            authData.user.id,
            authData.profile.player_id,
            userGuild,
            authData.profile.role
          ])
        )
        .digest('hex')
    : undefined

  const params = await searchParams

  const selectedGuild = params.guild || userGuild || ''
  const latestSeason = await getLatestSeason()
  const selectedSeason = resolveEffectiveSeason(params.season, latestSeason)

  if (!selectedSeason) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }

  return (
    <TokenUsage
      selectedGuild={selectedGuild}
      selectedSeason={selectedSeason}
      showForecast={showForecast}
      showSavedOutlook={isDesktop}
      savedOutlookContextKey={savedOutlookContextKey}
    />
  )
}
