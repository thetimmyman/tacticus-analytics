import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import {
  getSeasonPosition,
  SEASON_CONFIGS
} from '@/app/lib/loki/season-configs'
import { BossPlaybooksClient } from './BossPlaybooksClient'
import type { PlaybooksData, SeasonConfigInfo } from './types'
import playbooks from '@/data/boss-playbooks/playbooks.json'
import { loadSeasonalBossHubData } from './seasonal-hub-data'

export const metadata: Metadata = {
  title: 'Boss Playbooks | Tacticus Analytics',
  description:
    'Guild raid boss playbooks, maps, teams, strategy guides, and Herald operations.'
}

export default async function BossPlaybooksPage() {
  const { user, profile } = await requireAuth()
  const access = await checkFeatureAccess(user.id, 'boss_playbooks')
  if (!access.has_access) redirect('/home')

  const { index: currentSeasonIndex } = getSeasonPosition()
  const playbooksData = playbooks as PlaybooksData
  const canManageHerald = canManageHeraldRole(profile.role)
  const canManageTargets =
    canManageHerald ||
    Boolean((profile as { is_app_admin?: boolean }).is_app_admin)
  const seasonalHub = await loadSeasonalBossHubData(playbooksData, {
    guildCode: profile.guild_code ?? null,
    canManageHerald,
    canManageTargets
  })
  const allSeasons: SeasonConfigInfo[] = SEASON_CONFIGS.map((config, idx) => ({
    id: config.id,
    index: idx + 1,
    canonicals: config.canonicalOrder
  }))

  return (
    <BossPlaybooksClient
      currentSeasonIndex={currentSeasonIndex}
      allSeasons={allSeasons}
      playbooks={playbooksData}
      seasonalHub={seasonalHub}
    />
  )
}
