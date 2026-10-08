import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import {
  requireSeasonPlanReadContext,
  resolveSeasonPlanSeason
} from '@/app/api/guild-raid/season-plan/_shared'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import SeasonPlannerClient from '../season-planner/SeasonPlannerClient'
import { EmptyState } from '@tacticus/ui-kit'
import { redirect } from 'next/navigation'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignments } from '@/app/(dashboard)/boss-assignments/BossAssignments'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'

export const metadata = {
  title: 'Season Planner | Tacticus Analytics',
  description:
    'Plan the entire guild raid season using token regeneration, availability windows, and expected damage.'
}

export const dynamic = 'force-dynamic'

export default async function SeasonPlannerPage({
  searchParams
}: {
  searchParams?: Promise<{ season?: string }>
}) {
  if (getRuntimeProfile() === 'desktop') {
    const { supabase, profile } = await requireSeasonPlanReadContext()
    const params = await searchParams
    const { data, error } = await supabase.rpc(
      'get_distinct_seasons_for_guild',
      { p_guild: profile.guild_code }
    )
    if (error)
      return (
        <EmptyState title="Saved seasons unavailable">
          Try opening the workspace again.
        </EmptyState>
      )
    const seasons = (data ?? [])
      .filter((value) => typeof value === 'string')
      .sort((a, b) => Number(b) - Number(a))
    if (!seasons.length)
      return (
        <EmptyState title="Import saved raid history">
          Use API access and sync to import raid history before planning a saved
          season.
        </EmptyState>
      )
    const season = await resolveSeasonPlanSeason(
      params?.season ?? null,
      supabase,
      profile.guild_code
    )
    const configs = seasons.flatMap((value) => {
      const config = getSeasonConfigForSeasonNumber(Number(value))
      return config
        ? [{ seasonNumber: Number(value), configId: config.id }]
        : []
    })
    const selected = getSeasonConfigForSeasonNumber(Number(season))
    if (!selected)
      return (
        <EmptyState title="Captured configuration unavailable">
          This saved season has no supported captured boss configuration.
        </EmptyState>
      )
    return (
      <SeasonPlannerClient
        desktopMode
        canEdit={canManageHeraldRole(profile.role)}
        currentSeasonIndex={0}
        allSeasons={Array.from(
          new Map(
            configs.map((item) => {
              const config = getSeasonConfigForSeasonNumber(item.seasonNumber)!
              return [
                config.id,
                {
                  id: config.id,
                  index: item.seasonNumber,
                  canonicals: config.canonicalOrder
                }
              ]
            })
          ).values()
        )}
        initialSeason={season}
        initialConfigId={selected.id}
        seasonConfigResolutions={configs}
        savedSeasons={seasons}
      />
    )
  }
  const { profile, user, canEdit } = await requireBossAssignmentsAccess()

  const seasonAccess = await checkFeatureAccess(
    user.id,
    'boss_assignment_season_planner'
  )

  const canUseSeasonPlanner =
    canEdit && isOfficerLeaderOrAdminRole(profile.role)

  if (!canUseSeasonPlanner || !seasonAccess.has_access) {
    redirect('/boss-assignments/current')
  }

  return <BossAssignments profile={profile} mode="season" canEdit={canEdit} />
}
