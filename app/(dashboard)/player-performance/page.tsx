import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { getLatestSeason } from '@/app/lib/utils/season'
import { resolveEffectiveSeason } from '@/app/lib/season-date/precedence'
import { EmptyState } from '@tacticus/ui-kit'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Player Performance',
  description:
    'Compare guild member raid performance, season trends, and boss-by-boss contribution metrics.',
  path: '/player-performance'
})

const PlayerPerformanceContainer = dynamicImport(
  () => import('@/app/components/performance/PlayerPerformanceContainer'),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">
        Loading performance analytics...
      </div>
    )
  }
)

interface PageProps {
  searchParams: Promise<{ guild?: string; season?: string }>
}

export default async function PlayerPerformancePage({
  searchParams
}: PageProps) {
  const authData = await requireAuth()
  const userGuild = authData.profile.guild_code
  const userRole = authData.profile.role

  // Officers/leaders/admins edit target tokens, matching Boss Playbooks' canManageTargets.
  const role = String(userRole ?? '').toLowerCase()
  const canManageTargets =
    ['officer', 'leader', 'admin'].includes(role) ||
    Boolean((authData.profile as { is_app_admin?: boolean }).is_app_admin)

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
    <PlayerPerformanceContainer
      selectedGuild={selectedGuild}
      selectedSeason={selectedSeason}
      userGuild={userGuild ?? undefined}
      userRole={userRole ?? undefined}
      canManageTargets={canManageTargets}
    />
  )
}
