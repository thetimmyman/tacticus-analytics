import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import BossLevelSelector from '@/app/components/BossLevelSelector'
import { getLatestSeason } from '@/app/lib/utils/season'
import { resolveEffectiveSeason } from '@/app/lib/season-date/precedence'
import { EmptyState } from '@tacticus/ui-kit'
import {
  normalizeRarity,
  sortRaritiesByHierarchy
} from '@tacticus/app-core/rarity-utils'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Boss Performance',
  description:
    'Compare guild raid boss damage by season, rarity, level, and guild to find stronger raid strategies.',
  path: '/boss'
})

interface PageProps {
  searchParams: Promise<{
    guild?: string
    season?: string
    level?: string
    rarity?: string
    rarities?: string
  }>
}

const BossPerformanceContainer = dynamicImport(
  () => import('@/app/components/boss-performance/BossPerformanceContainer'),
  {
    loading: () => (
      <div className="rounded-md border border-card-border/60 bg-[var(--card-bg)] p-4 text-[var(--text-secondary)]">
        Loading boss performance…
      </div>
    )
  }
)

export default async function BossPerformancePage({ searchParams }: PageProps) {
  const authData = await requireAuth()
  const userGuild = authData.profile.guild_code

  const params = await searchParams

  const selectedGuild = params.guild || userGuild || ''
  const latestSeason = await getLatestSeason()
  const selectedSeason = resolveEffectiveSeason(params.season, latestSeason)
  const selectedLevel = params.level || 'L1' // Default to L1 if not specified

  if (!selectedSeason) {
    return (
      <div className="px-4 py-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          Boss Performance
        </h1>
        <EmptyState title="Season data unavailable" className="mt-6">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }
  const selectedRaritiesParam = params.rarity ?? params.rarities

  let initialRarities: Rarity[] | undefined
  if (selectedRaritiesParam) {
    const parsed = selectedRaritiesParam
      .split(',')
      .map((value) => normalizeRarity(value))
      .filter((value): value is Rarity => Boolean(value))
    if (parsed.length > 0) {
      initialRarities = sortRaritiesByHierarchy(parsed)
    }
  }

  return (
    <div className="px-4 py-6">
      <div className="space-y-6">
        {/* Boss Performance Title */}
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          Boss Performance
        </h1>

        {/* Boss Level Sub-Navigation */}
        <BossLevelSelector
          selectedLevel={selectedLevel}
          selectedSeason={selectedSeason}
          initialRarities={initialRarities ?? []}
        />

        {/* Boss Performance Component */}
        <BossPerformanceContainer
          selectedGuild={selectedGuild}
          selectedSeason={selectedSeason}
          level={selectedLevel}
        />
      </div>
    </div>
  )
}
