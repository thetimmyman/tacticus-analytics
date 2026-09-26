import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import dynamic from 'next/dynamic'
import { AssignmentsLoading } from './_components/AssignmentsLoading'
import { getHistoricalBossPerformance } from '@/app/lib/data/boss-performance'
import { buildBattleRowsQuery } from '@/app/lib/data/battle-rows'
import { getLatestSeason } from '@/app/lib/utils/season'
import { db } from '@/app/lib/db'
import { EmptyState } from '@tacticus/ui-kit'
import type { UserProfile } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('boss-assignments.BossAssignments')
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { getGuildTokenPerformance } from '@/app/lib/data/guild-token-performance'
import type {
  TokenPerformanceData,
  HeraldCascadeConfigEntry
} from '@/app/(dashboard)/guild-management/upcoming-assignments/types'
import type { Database } from '@tacticus/app-core/types'
import type { UpcomingAssignmentsClientProps } from '@/app/(dashboard)/guild-management/upcoming-assignments/UpcomingAssignmentsClient'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { buildHeraldCanonicalKey } from '@/app/lib/boss-assignments/herald-canonical-key'
import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'
import {
  getSeasonPosition,
  getSeasonConfigIdForOffset,
  SEASON_CONFIGS
} from '@/app/lib/loki/season-configs'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'
import type { SeasonConfigInfo } from '@/app/(dashboard)/boss-playbooks/types'
import { AssignmentSeasonWindow } from './_components/AssignmentSeasonWindow'
import { BossAssignmentsReadOnlyBanner } from './_components/BossAssignmentsReadOnlyBanner'
import {
  SEASON_WINDOW_OFFSETS,
  buildSeasonWindowNumbers,
  buildSeasonWindowOptions,
  resolveSeasonConfigId,
  resolveSelectedSeason,
  type SeasonConfigResolution
} from './_lib/season-window'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { buildBossAssignmentAverageDamageMap } from './_lib/average-damage'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'

const CurrentAssignmentsClient = dynamic(
  () => import('./clients/CurrentAssignmentsClient'),
  {
    loading: () => <AssignmentsLoading label="Loading assignments..." />
  }
)

const SeasonPlannerClient = dynamic(
  () => import('./season-planner/SeasonPlannerClient'),
  {
    loading: () => <AssignmentsLoading label="Loading season planner..." />
  }
)

const PerformanceLeaderboardClient = dynamic(
  () => import('./performance/PerformanceLeaderboardClient'),
  {
    loading: () => (
      <AssignmentsLoading label="Loading performance leaderboard..." />
    )
  }
)

// Interactive path is always 'current': /upcoming redirects and non-live seasons get the planner.
type AssignmentMode = 'current' | 'season' | 'performance'

interface BossAssignmentsProps {
  profile: UserProfile
  mode: AssignmentMode
  /** Officer/leader/app-admin edit access; false renders every client read-only. */
  canEdit: boolean
  /** Null/undefined = live season / per-boss most-recent season. */
  seasonOverride?: string | null
}

function buildAllSeasonConfigInfo(): SeasonConfigInfo[] {
  return SEASON_CONFIGS.map((config, idx) => ({
    id: config.id,
    index: idx + 1,
    canonicals: config.canonicalOrder
  }))
}

function buildSeasonConfigResolutions(
  seasonNumbers: readonly number[]
): SeasonConfigResolution[] {
  const globalCurrentSeasonNumber = getSeasonConfigIdForOffset(0).seasonNumber
  return Array.from(
    new Set(seasonNumbers.filter((n) => Number.isFinite(n)))
  ).map((seasonNumber) => ({
    seasonNumber,
    configId: getSeasonConfigIdForOffset(
      seasonNumber - globalCurrentSeasonNumber
    ).id
  }))
}

type PlayerMappingRow = Pick<
  Database['public']['Tables']['player_mapping']['Row'],
  'display_name'
>
type SeasonRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  'Name' | 'Season'
>
type DamageRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'displayName'
  | 'userId'
  | 'Name'
  | 'set'
  | 'damageDealt'
  | 'remainingHp'
  | 'maxHp'
  | 'Season'
  | 'rarity'
  | 'loopIndex'
>

export async function BossAssignments({
  profile,
  mode,
  canEdit,
  seasonOverride = null
}: BossAssignmentsProps) {
  if (mode === 'season') {
    const {
      index: currentSeasonIndex,
      seasonNumber: globalCurrentSeasonNumber
    } = getSeasonPosition()
    const liveConfigId = getSeasonConfigIdForOffset(0).id
    const seasonConfigResolutions = buildSeasonConfigResolutions(
      Array.from(
        { length: 121 },
        (_, index) => globalCurrentSeasonNumber + index - 60
      )
    )
    return (
      <SeasonPlannerClient
        canEdit={canEdit}
        currentSeasonIndex={currentSeasonIndex}
        allSeasons={buildAllSeasonConfigInfo()}
        liveConfigId={liveConfigId}
        seasonConfigResolutions={seasonConfigResolutions}
      />
    )
  }

  const guildCode = profile.guild_code ?? ''
  const supabase = await db()

  const [
    latestSeason,
    bossHpData,
    rotationSnapshot,
    heraldBossConfigsRaw,
    guildConfigResult,
    clusterLatestSeasonResult
  ] = await Promise.all([
    getLatestSeason(),
    getAllBossHp(guildCode),
    ensureRotationSnapshot(),
    // Herald per-prime config; on error every prime defaults to 'kill'.
    supabase
      .from('herald_boss_config')
      .select(
        'boss_id, rarity_set, side1_behaviour, side2_behaviour, side1_threshold_hp_pct, side2_threshold_hp_pct'
      )
      .eq('guild_code', guildCode)
      .then(
        ({ data }) =>
          (data as Array<Record<string, unknown>> | null)?.map(
            (row): HeraldCascadeConfigEntry => {
              const bossId = String(row.boss_id ?? '')
              return {
                boss_id: bossId,
                canonical_key: buildHeraldCanonicalKey(bossId),
                rarity_set:
                  typeof row.rarity_set === 'string' &&
                  row.rarity_set.length > 0
                    ? row.rarity_set
                    : null,
                side1_behaviour:
                  row.side1_behaviour === 'skip' ||
                  row.side1_behaviour === 'threshold'
                    ? row.side1_behaviour
                    : 'kill',
                side2_behaviour:
                  row.side2_behaviour === 'skip' ||
                  row.side2_behaviour === 'threshold'
                    ? row.side2_behaviour
                    : 'kill',
                side1_threshold_hp_pct:
                  typeof row.side1_threshold_hp_pct === 'number'
                    ? row.side1_threshold_hp_pct
                    : null,
                side2_threshold_hp_pct:
                  typeof row.side2_threshold_hp_pct === 'number'
                    ? row.side2_threshold_hp_pct
                    : null
              }
            }
          ) ?? []
      ),
    supabase
      .from('guild_config')
      .select('primary_assignment_tokens, secondary_assignment_tokens')
      .eq('guild_code', guildCode)
      .single(),
    // Anchor on the cluster's latest season, not the global one: a lagging cluster would
    // otherwise get a queue for a season it has no data in.
    supabase.rpc('get_cluster_latest_season')
  ])
  const initialHeraldBossConfigs: HeraldCascadeConfigEntry[] =
    heraldBossConfigsRaw
  const guildConfig = guildConfigResult.data

  // Downstream props need a string, so show an explicit unavailable state.
  if (latestSeason === null) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }

  // The cluster live season shows the interactive queue; any other the Season Planner.
  const clusterLatestSeason =
    !clusterLatestSeasonResult.error &&
    typeof clusterLatestSeasonResult.data === 'string' &&
    clusterLatestSeasonResult.data.length > 0
      ? clusterLatestSeasonResult.data
      : latestSeason
  const clusterLatestSeasonNumber = Number.parseInt(clusterLatestSeason, 10)

  const { selectedSeason, isLiveSeason } = resolveSelectedSeason(
    seasonOverride,
    clusterLatestSeason
  )

  // Includes the selected season so an out-of-window pill still highlights.
  const windowSeasonNumbers = buildSeasonWindowNumbers(
    SEASON_WINDOW_OFFSETS.map(
      (offset) => getSeasonConfigIdForOffset(offset).seasonNumber
    ),
    selectedSeason
  )
  const seasonWindowOptions = buildSeasonWindowOptions(
    windowSeasonNumbers,
    clusterLatestSeasonNumber
  )

  // A non-live selection plans its own rotation config.
  const selectedSeasonNumber = Number.parseInt(selectedSeason, 10)
  const globalCurrentSeasonNumber = getSeasonConfigIdForOffset(0).seasonNumber
  const seasonConfigResolutions = buildSeasonConfigResolutions([
    ...SEASON_WINDOW_OFFSETS.map(
      (offset) => globalCurrentSeasonNumber + offset
    ),
    selectedSeasonNumber,
    clusterLatestSeasonNumber
  ])
  const selectedConfigId = resolveSeasonConfigId(
    seasonConfigResolutions,
    selectedSeason
  )
  const liveConfigId = resolveSeasonConfigId(
    seasonConfigResolutions,
    clusterLatestSeasonNumber
  )
  const seasonSelector = (
    <AssignmentSeasonWindow
      options={seasonWindowOptions}
      value={selectedSeason}
    />
  )

  if (mode !== 'performance' && !isLiveSeason) {
    const { index: currentSeasonIndex } = getSeasonPosition()

    // Planning APIs are officer+flag-gated, so mount the same way (EmptyState, not a 403).
    const seasonPlannerFlagAccess =
      canEdit && profile.user_id
        ? (
            await checkFeatureAccess(
              profile.user_id,
              'boss_assignment_season_planner'
            )
          ).has_access
        : false
    const canPlanSeasons =
      canEdit &&
      isOfficerLeaderOrAdminRole(profile.role) &&
      seasonPlannerFlagAccess

    if (!canPlanSeasons) {
      return (
        <div className="space-y-4">
          {seasonSelector}
          <EmptyState title={`Planning projection — Season ${selectedSeason}`}>
            {!canEdit
              ? `The planning projection for a non-live season is available to officers and leaders. Select the live season (S${clusterLatestSeason}) to see the read-only assignment queue.`
              : !isOfficerLeaderOrAdminRole(profile.role)
                ? `The planning projection for a non-live season is available to guild officers and leaders. Select the live season (S${clusterLatestSeason}) to see the live assignment queue.`
                : `Season planning isn't available for your guild yet. Select the live season (S${clusterLatestSeason}) to see the live assignment queue.`}
          </EmptyState>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {seasonSelector}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-semibold text-amber-100">
            Planning projection — Season {selectedSeason}
          </span>
          . This is a forward/historical plan, not the live assignment queue.
          Select the live season (S{clusterLatestSeason}) to return to live
          assignments.
        </div>
        <SeasonPlannerClient
          // Remount on season change: App Router reuses the instance, so lazy useState goes stale.
          key={selectedSeason}
          canEdit={canEdit}
          currentSeasonIndex={currentSeasonIndex}
          allSeasons={buildAllSeasonConfigInfo()}
          initialSeason={selectedSeason}
          initialConfigId={selectedConfigId}
          liveConfigId={liveConfigId}
          seasonConfigResolutions={seasonConfigResolutions}
        />
      </div>
    )
  }

  let performanceData: Record<
    string,
    Record<string, { player_vs_guild_avg: number; average_damage?: number }>
  > = {}
  let tokenPerformanceData: TokenPerformanceData = {}
  let primeHpData: Record<string, number> = {}
  // `undefined` = lib self-fetches, `null`/`[]` = explicit empty; a failed fetch leaves undefined.
  let damageDataRows: DamageRow[] | null | undefined
  let mostRecentSeasonPerBossShared: Record<string, string> | undefined

  try {
    const perfData = await getHistoricalBossPerformance(guildCode)

    const { data: playerMapping } = await guildRosterQuery(
      supabase,
      guildCode,
      'display_name'
    )

    const playerMappingNames = new Set(
      (playerMapping as PlayerMappingRow[] | null)
        ?.map((p) => p.display_name)
        .filter(Boolean) ?? []
    )

    // Order by startedOn, not TEXT Season: '99' lex-sorts before '100' and the cap drops S100.
    const { data: bossSeasons } = await supabase
      .from('EOT_GR_data')
      .select('Name, Season')
      .eq('Guild', guildCode)
      .eq('encounterId', 0)
      .in('rarity', ['Legendary', 'Mythic'])
      .not('Name', 'is', null)
      .order('startedOn', { ascending: false })

    const mostRecentSeasonPerBoss: Record<string, string> = {}
    ;(bossSeasons as SeasonRow[] | null)?.forEach((row) => {
      if (row?.Name && row?.Season && !mostRecentSeasonPerBoss[row.Name]) {
        mostRecentSeasonPerBoss[row.Name] = row.Season
      }
    })
    mostRecentSeasonPerBossShared = mostRecentSeasonPerBoss

    // Canonical battle-row stack (invariants on buildBattleRowsQuery); killing blows classified below.
    const { data: damageData } = await buildBattleRowsQuery<DamageRow>(
      supabase,
      {
        select:
          'displayName, userId, Name, set, damageDealt, remainingHp, maxHp, Season, rarity, loopIndex',
        scope: { guild: guildCode },
        rarities: ['Legendary', 'Mythic']
      }
    )
    // null (error) tells the lib not to retry against a failing DB; keep it distinct from undefined.
    damageDataRows = damageData as DamageRow[] | null

    // Same stack; ordering by damage would truncate low-damage primes.
    const { data: primeData } = await buildBattleRowsQuery<DamageRow>(
      supabase,
      {
        select:
          'displayName, Name, set, damageDealt, remainingHp, maxHp, Season, rarity',
        scope: { guild: guildCode },
        rarities: ['Legendary', 'Mythic'],
        encounters: 'primes'
      }
    )

    const avgDamageMap = buildBossAssignmentAverageDamageMap(
      [
        ...((damageData as DamageRow[] | null) ?? []),
        ...((primeData as DamageRow[] | null) ?? [])
      ],
      selectedSeason
    )

    const eotGrNames = new Set<string>()
    ;(damageData as DamageRow[] | null)?.forEach((row) => {
      if (row.displayName) {
        eotGrNames.add(row.displayName)
      }
    })

    const missingInPlayerMapping = Array.from(eotGrNames).filter(
      (name) => !playerMappingNames.has(name)
    )
    const missingInEOTGR = Array.from(playerMappingNames).filter(
      (name) => !eotGrNames.has(name)
    )

    if (missingInPlayerMapping.length > 0) {
      logger.warn(
        {
          guild: guildCode,
          missingCount: missingInPlayerMapping.length,
          sample: missingInPlayerMapping.slice(0, 10)
        },
        'Detected players in battle data without player_mapping entries; consider syncing mappings.'
      )
    }

    if (missingInEOTGR.length > 0) {
      logger.warn(
        {
          guild: guildCode,
          missingCount: missingInEOTGR.length,
          sample: missingInEOTGR.slice(0, 10)
        },
        'Detected player_mapping rows without recent battle history.'
      )
    }

    type CombinedEntry = {
      player_vs_guild_avg: number
      average_damage?: number
    }
    type PlayerBossPerformance = {
      boss_name: string
      player_vs_guild_avg: number
    }

    const combined = new Map<string, Map<string, CombinedEntry>>()

    Object.entries(perfData as Record<string, PlayerBossPerformance[]>).forEach(
      ([playerName, bosses]) => {
        const playerEntry = new Map<string, CombinedEntry>()
        combined.set(playerName, playerEntry)

        bosses.forEach((boss) => {
          playerEntry.set(boss.boss_name, {
            player_vs_guild_avg: boss.player_vs_guild_avg
          })
        })
      }
    )

    Object.entries(avgDamageMap).forEach(([playerName, bosses]) => {
      let playerEntry = combined.get(playerName)
      if (!playerEntry) {
        playerEntry = new Map<string, CombinedEntry>()
        combined.set(playerName, playerEntry)
      }

      Object.entries(bosses).forEach(([bossKey, data]) => {
        const bossName = bossKey.replace(/_[ML]\d+$/, '')

        let bossEntry = playerEntry.get(bossName)
        if (!bossEntry) {
          bossEntry = {
            player_vs_guild_avg: 0
          }
          playerEntry.set(bossName, bossEntry)
        }

        bossEntry.average_damage = data.average
        playerEntry.set(bossKey, {
          player_vs_guild_avg: bossEntry.player_vs_guild_avg,
          average_damage: data.average
        })
      })
    })

    const primeHpMap: Record<string, number> = {}
    ;(primeData as DamageRow[] | null)?.forEach((row) => {
      if (!row.Name) return
      const difficultyCode = difficultyCodeFromOneBasedSet(
        row.rarity === 'Mythic' ? 'Mythic' : 'Legendary',
        (row.set ?? 0) + 1
      )
      const primeKey = `${row.Name}_${difficultyCode}`
      const totalHp = (row.damageDealt ?? 0) + (row.remainingHp ?? 0)

      if (!primeHpMap[primeKey] || totalHp > primeHpMap[primeKey]) {
        primeHpMap[primeKey] = totalHp
      }
    })

    // Object.fromEntries keeps reserved names as own properties in a serializable object.
    performanceData = Object.fromEntries(
      Array.from(combined, ([playerName, bosses]) => [
        playerName,
        Object.fromEntries(bosses)
      ])
    )
    primeHpData = primeHpMap
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.error({ err: errorMessage }, 'Error fetching performance data:')
  }

  // Reuses the fetched rows so EOT_GR_data is not re-queried.
  tokenPerformanceData = await getGuildTokenPerformance(guildCode, {
    seasonOverride: selectedSeason,
    prefetched: {
      damageData: damageDataRows,
      mostRecentSeasonPerBoss: mostRecentSeasonPerBossShared,
      bossHpData
    }
  })

  if (mode === 'performance') {
    return (
      <PerformanceLeaderboardClient
        tokenPerformance={tokenPerformanceData}
        latestSeason={clusterLatestSeason}
        selectedSeason={selectedSeason}
        guildCode={guildCode}
      />
    )
  }

  // A failure only disables synthetic stage advancement; the loader logs it.
  const progressionConfig = await getActiveProgressionConfig(
    guildCode,
    Number.parseInt(clusterLatestSeason, 10)
  ).catch(() => null)

  const clientProps: UpcomingAssignmentsClientProps = {
    initialProfile: profile,
    initialPerformanceData: performanceData,
    initialTokenPerformanceData: tokenPerformanceData,
    initialLatestSeason: clusterLatestSeason,
    initialPrimeHpData: primeHpData,
    initialBossHpData: bossHpData,
    guildConfig: guildConfig
      ? {
          primary_assignment_tokens:
            guildConfig.primary_assignment_tokens ?? undefined,
          secondary_assignment_tokens:
            guildConfig.secondary_assignment_tokens ?? undefined
        }
      : null,
    mode: 'current',
    canEdit,
    lokiCurrentBosses: rotationSnapshot?.currentBosses ?? [],
    progressionConfig,
    initialHeraldBossConfigs
  }

  return (
    <div className="space-y-4">
      {seasonSelector}
      {/* Members see the officer layout; the banner explains the missing controls. */}
      <BossAssignmentsReadOnlyBanner canEdit={canEdit} />
      <CurrentAssignmentsClient {...clientProps} />
    </div>
  )
}
