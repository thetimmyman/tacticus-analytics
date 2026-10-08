import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { getGuildPerBossActualTokens } from '@/app/lib/data/guild-per-boss-actual-tokens'
import { db } from '@/app/lib/db'
import { getLatestSeason } from '@/app/lib/utils/season'
import {
  getSeasonConfigForSeasonNumber,
  getSeasonConfigIdForOffset
} from '@/app/lib/loki/season-configs'
import { EmptyState } from '@tacticus/ui-kit'
import {
  SEASON_WINDOW_OFFSETS,
  buildSeasonWindowNumbers,
  buildSeasonWindowOptions,
  resolveSelectedSeason
} from '@/app/(dashboard)/boss-assignments/_lib/season-window'
import { loadTargetsOpsSlice } from './_lib/load-targets-ops-slice'
import TargetsClient from './TargetsClient'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'

// Per-request rendering so a `?season=` change re-runs this component.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Boss Target Tokens | Tacticus Analytics',
  description: 'Officer-editable normative target tokens per boss'
}

interface PageProps {
  searchParams: Promise<{ season?: string }>
}

export default async function TargetTokensPage({ searchParams }: PageProps) {
  const { profile, canEdit, canManageHerald, canSeed } =
    await requireBossAssignmentsAccess()

  const guildCode = profile.guild_code ?? ''
  const params = await searchParams
  const seasonOverride = params.season ?? null
  const desktopMode = getRuntimeProfile() === 'desktop'
  if (seasonOverride !== null && parseSeasonParam(seasonOverride) === null)
    return (
      <EmptyState title="Invalid season">
        Choose a positive season number before editing targets.
      </EmptyState>
    )

  const supabase = await db()
  // Live actuals for the tooltip (non-fatal), anchored on the cluster's latest season.
  const [latestSeason, clusterLatestSeasonResult, perBossActuals] =
    await Promise.all([
      getLatestSeason(),
      supabase.rpc('get_cluster_latest_season'),
      guildCode ? getGuildPerBossActualTokens(guildCode) : Promise.resolve({})
    ])

  const clusterLatestSeason =
    !clusterLatestSeasonResult.error &&
    typeof clusterLatestSeasonResult.data === 'string' &&
    clusterLatestSeasonResult.data.length > 0
      ? clusterLatestSeasonResult.data
      : (latestSeason ?? '')

  const savedSeasons = desktopMode
    ? ((
        await supabase.rpc('get_distinct_seasons_for_guild', {
          p_guild: guildCode
        })
      ).data ?? [])
    : []
  let { selectedSeason } = resolveSelectedSeason(
    seasonOverride,
    clusterLatestSeason
  )
  if (
    desktopMode &&
    seasonOverride === null &&
    getSeasonConfigForSeasonNumber(Number(selectedSeason)) === null
  ) {
    // Default navigation may outlive the captured rotation window. Keep saved
    // captured data reachable without inferring any older season's lineup.
    selectedSeason =
      [...savedSeasons]
        .filter(
          (season) =>
            parseSeasonParam(season) !== null &&
            getSeasonConfigForSeasonNumber(Number(season)) !== null
        )
        .sort((a, b) => Number(b) - Number(a))[0] ?? selectedSeason
  }

  // No resolvable season would write the '' legacy row and read unscoped; render unavailable.
  const selectedSeasonNumber = Number.parseInt(selectedSeason, 10)
  if (!Number.isFinite(selectedSeasonNumber) || selectedSeasonNumber <= 0) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the current season right now, so
          target-token editing is disabled to avoid writing a cross-season
          target. Please try again shortly.
        </EmptyState>
      </div>
    )
  }

  if (
    desktopMode &&
    getSeasonConfigForSeasonNumber(selectedSeasonNumber) === null
  ) {
    return (
      <EmptyState title="Season configuration unavailable">
        Choose a saved season with a captured boss configuration before editing
        targets.
      </EmptyState>
    )
  }

  const clusterLatestSeasonNumber = Number.parseInt(clusterLatestSeason, 10)

  const windowSeasonNumbers = buildSeasonWindowNumbers(
    desktopMode
      ? savedSeasons.map(Number)
      : SEASON_WINDOW_OFFSETS.map(
          (offset) => getSeasonConfigIdForOffset(offset).seasonNumber
        ),
    selectedSeason
  )
  const seasonOptions = buildSeasonWindowOptions(
    windowSeasonNumbers,
    clusterLatestSeasonNumber
  )
    .filter(
      (option) =>
        !desktopMode ||
        getSeasonConfigForSeasonNumber(Number(option.value)) !== null
    )
    .map((option) =>
      desktopMode
        ? {
            ...option,
            label: `${savedSeasons.includes(option.value) ? 'Saved · ' : ''}S${option.value}`
          }
        : option
    )

  // Runs after the season guard; gated on `canManageHerald`.
  const opsSlice = await loadTargetsOpsSlice({
    guildCode,
    seasonNumber: selectedSeasonNumber,
    enabled: canManageHerald
  })

  return (
    <TargetsClient
      guildCode={guildCode}
      perBossActuals={perBossActuals}
      canEdit={canEdit}
      canSeed={!desktopMode && canSeed}
      opsSlice={opsSlice}
      canManageHerald={!desktopMode && canManageHerald}
      desktopMode={desktopMode}
      // Uses the cluster anchor; the hub's rotation math would disagree on a lagging cluster.
      isCurrentSeason={selectedSeason === clusterLatestSeason}
      seasonOptions={seasonOptions}
      selectedSeason={selectedSeason}
    />
  )
}
