import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATEGORIES,
  ADDITIONAL_ACHIEVEMENT_COUNT,
  getAchievementMetricValue,
  getAchievementSeries
} from '@/app/lib/achievements/catalog'
import {
  getAchievementEvaluation,
  type AchievementPlayerContext
} from '@/app/lib/achievements/evaluate'

export const dynamic = 'force-dynamic'

interface PlayerContextRow {
  id: number | null
  user_id: string | null
  player_id: string
  display_name: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
  player_power: number | null
  player_level: number | null
  tacticus_api_key_encrypted: string | null
  tacticus_share_url: string | null
  discord_user_id: string | null
  timezone: string | null
  primary_boss: string | null
  secondary_boss: string | null
  primary_team: string | null
  secondary_team: string | null
  tertiary_team: string | null
  is_app_admin: boolean | null
}

interface PersistedAchievementRow {
  achievement_key: string
  unlocked_at: string
  value: unknown
}

function mapPlayerContext(row: PlayerContextRow): AchievementPlayerContext {
  return {
    mappingId: row.id,
    userId: row.user_id,
    playerId: row.player_id,
    displayName: row.display_name,
    guildCode: row.guild_code,
    clusterCode: row.cluster_code,
    playerPower: row.player_power,
    playerLevel: row.player_level,
    tacticusApiKeyEncrypted: row.tacticus_api_key_encrypted,
    tacticusShareUrl: row.tacticus_share_url,
    discordUserId: row.discord_user_id,
    timezone: row.timezone,
    primaryBoss: row.primary_boss,
    secondaryBoss: row.secondary_boss,
    primaryTeam: row.primary_team,
    secondaryTeam: row.secondary_team,
    tertiaryTeam: row.tertiary_team,
    isAppAdmin: row.is_app_admin
  }
}

interface AchievementTier {
  key: string
  displayName: string
  description: string
  icon: string
  category: string
  categoryLabel: string
  metric: string
  metricLabel: string
  rarity: string
  points: number
  tier: number | null
  threshold: number | null
  unlocked: boolean
  unlockedAt: string | null
  value: unknown
  progress: { current: number; target: number; percent: number } | null
  seriesKey: string
}

interface AchievementSeriesResponse {
  seriesKey: string
  displayName: string
  description: string
  icon: string
  category: string
  categoryLabel: string
  metric: string
  metricLabel: string
  totalTiers: number
  unlockedTiers: number
  currentTier: number | null
  nextTierIndex: number | null
  currentValue: number
  nextThreshold: number | null
  /** From the previous tier's threshold toward `nextThreshold`. */
  progressToNext: number
  pointsEarned: number
  pointsAvailable: number
  allMaxed: boolean
  topRarity: string
  currentRarity: string | null
  tiers: AchievementTier[]
}

function emptyAchievements(): AchievementTier[] {
  return ACHIEVEMENT_CATALOG.map((achievement) => ({
    key: achievement.key,
    displayName: achievement.displayName,
    description: achievement.description,
    icon: achievement.icon,
    category: achievement.category,
    categoryLabel: achievement.categoryLabel,
    metric: achievement.metric,
    metricLabel: achievement.metricLabel,
    rarity: achievement.rarity,
    points: achievement.points,
    tier: achievement.tier ?? null,
    threshold: achievement.threshold ?? null,
    unlocked: false,
    unlockedAt: null,
    value: null,
    progress: achievement.threshold
      ? { current: 0, target: achievement.threshold, percent: 0 }
      : null,
    seriesKey: achievement.seriesKey
  }))
}

function buildSeries(
  achievements: AchievementTier[]
): AchievementSeriesResponse[] {
  const definitions = getAchievementSeries()
  const tiersByKey = new Map<string, AchievementTier[]>()
  for (const achievement of achievements) {
    const list = tiersByKey.get(achievement.seriesKey)
    if (list) {
      list.push(achievement)
    } else {
      tiersByKey.set(achievement.seriesKey, [achievement])
    }
  }
  return definitions.map((def) => {
    const tiers = (tiersByKey.get(def.seriesKey) ?? [])
      .slice()
      .sort((a, b) => (a.threshold ?? 1) - (b.threshold ?? 1))
    const unlocked = tiers.filter((tier) => tier.unlocked)
    const unlockedTiers = unlocked.length
    const currentTier = unlockedTiers > 0 ? unlockedTiers : null
    const currentRarity =
      unlockedTiers > 0 ? (tiers[unlockedTiers - 1]?.rarity ?? null) : null
    const nextTierIndex = unlockedTiers < tiers.length ? unlockedTiers : null
    const nextTier = nextTierIndex !== null ? tiers[nextTierIndex] : null
    const currentValue = tiers[0]?.progress?.current ?? 0
    const previousThreshold =
      unlockedTiers > 0 ? (tiers[unlockedTiers - 1]?.threshold ?? 0) : 0
    const nextThreshold = nextTier?.threshold ?? null
    const progressToNext = (() => {
      if (nextThreshold === null) return 100
      const span = nextThreshold - previousThreshold
      if (span <= 0) return 100
      const reached = Math.max(0, currentValue - previousThreshold)
      return Math.min(100, Math.round((reached / span) * 100))
    })()
    const pointsEarned = unlocked.reduce((sum, tier) => sum + tier.points, 0)
    const pointsAvailable = tiers.reduce((sum, tier) => sum + tier.points, 0)
    return {
      seriesKey: def.seriesKey,
      displayName: def.displayName,
      description: def.description,
      icon: def.icon,
      category: def.category,
      categoryLabel: def.categoryLabel,
      metric: def.metric,
      metricLabel: def.metricLabel,
      totalTiers: tiers.length,
      unlockedTiers,
      currentTier,
      nextTierIndex,
      currentValue,
      nextThreshold,
      progressToNext,
      pointsEarned,
      pointsAvailable,
      allMaxed: unlockedTiers > 0 && unlockedTiers === tiers.length,
      topRarity: def.topRarity,
      currentRarity,
      tiers
    }
  })
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Authentication required')
  )

  // The encrypted key is not readable by `authenticated`.
  const svc = serviceDb()

  const { data: callerRaw } = await svc
    .from('player_mapping')
    .select(
      'id,user_id,player_id,display_name,guild_code,cluster_code,role,player_power,player_level,tacticus_api_key_encrypted,tacticus_share_url,discord_user_id,timezone,primary_boss,secondary_boss,primary_team,secondary_team,tertiary_team,is_app_admin'
    )
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()

  const caller = (callerRaw ?? null) as PlayerContextRow | null

  if (!caller?.player_id) {
    const emptyTiers = emptyAchievements()
    return NextResponse.json({
      achievements: emptyTiers,
      series: buildSeries(emptyTiers),
      categories: ACHIEVEMENT_CATEGORIES,
      stats: {},
      summary: {
        total: ACHIEVEMENT_CATALOG.length,
        additional: ADDITIONAL_ACHIEVEMENT_COUNT,
        unlocked: 0,
        points: 0,
        completionPercent: 0
      },
      targetPlayer: null
    })
  }

  const targetPlayerId =
    request.nextUrl.searchParams.get('playerId') ??
    request.nextUrl.searchParams.get('player_id') ??
    caller.player_id

  let target = caller
  const isSelf = targetPlayerId === caller.player_id
  const canViewGuildMembers = canManageHeraldRole(caller.role)

  if (!isSelf) {
    if (!canViewGuildMembers) {
      throw Errors.forbidden(
        'Only guild officers and leaders can view member achievements'
      )
    }

    const { data: targetRaw } = await svc
      .from('player_mapping')
      .select(
        'id,user_id,player_id,display_name,guild_code,cluster_code,role,player_power,player_level,tacticus_api_key_encrypted,tacticus_share_url,discord_user_id,timezone,primary_boss,secondary_boss,primary_team,secondary_team,tertiary_team,is_app_admin'
      )
      .eq('player_id', targetPlayerId)
      .eq('is_current', true)
      .maybeSingle()

    const resolvedTarget = (targetRaw ?? null) as PlayerContextRow | null
    if (!resolvedTarget?.player_id) {
      throw Errors.notFound('Player', 'Player not found')
    }

    if (
      !caller.guild_code ||
      !resolvedTarget.guild_code ||
      caller.guild_code !== resolvedTarget.guild_code
    ) {
      throw Errors.forbidden(
        'You can only view achievements for your own guild'
      )
    }

    target = resolvedTarget
  }

  const evaluation = await getAchievementEvaluation(
    svc,
    target.player_id,
    mapPlayerContext(target)
  )

  const persistedMap = new Map<
    string,
    { unlocked_at: string; value: unknown }
  >()

  if (target.user_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- player_achievements not in generated types until migration applied
      const { data: persisted } = (await (svc.from as any)(
        'player_achievements'
      )
        .select('achievement_key, unlocked_at, value')
        .eq('user_id', target.user_id)) as {
        data: PersistedAchievementRow[] | null
      }

      for (const row of persisted ?? []) {
        persistedMap.set(row.achievement_key, {
          unlocked_at: row.unlocked_at,
          value: row.value
        })
      }
    } catch {
      // The table may be missing pre-migration; live evaluation still works.
    }
  }

  const evaluatedMap = new Map(
    evaluation.unlocked.map((achievement) => [
      achievement.achievement_key,
      achievement
    ])
  )

  const achievements = ACHIEVEMENT_CATALOG.map((definition) => {
    const persisted = persistedMap.get(definition.key)
    const live = evaluatedMap.get(definition.key)
    const unlocked = Boolean(persisted || live)
    const current = getAchievementMetricValue(
      evaluation.stats,
      definition.metric
    )
    const targetValue = definition.threshold ?? 1
    const percent =
      targetValue > 0
        ? Math.min(100, Math.round((current / targetValue) * 100))
        : 100

    return {
      key: definition.key,
      displayName: definition.displayName,
      description: definition.description,
      icon: definition.icon,
      category: definition.category,
      categoryLabel: definition.categoryLabel,
      metric: definition.metric,
      metricLabel: definition.metricLabel,
      rarity: definition.rarity,
      points: definition.points,
      tier: definition.tier ?? null,
      threshold: definition.threshold ?? null,
      unlocked,
      unlockedAt: persisted?.unlocked_at ?? null,
      value: persisted?.value ??
        live?.value ?? {
          metric: definition.metric,
          metricLabel: definition.metricLabel,
          current,
          threshold: targetValue,
          category: definition.category
        },
      progress: {
        current,
        target: targetValue,
        percent
      },
      seriesKey: definition.seriesKey
    }
  })

  const unlockedCount = achievements.filter(
    (achievement) => achievement.unlocked
  ).length
  const points = achievements.reduce(
    (sum, achievement) => sum + (achievement.unlocked ? achievement.points : 0),
    0
  )

  const series = buildSeries(achievements)

  return NextResponse.json({
    achievements,
    series,
    categories: ACHIEVEMENT_CATEGORIES,
    stats: evaluation.stats,
    summary: {
      total: achievements.length,
      additional: ADDITIONAL_ACHIEVEMENT_COUNT,
      unlocked: unlockedCount,
      points,
      completionPercent:
        achievements.length > 0
          ? Math.round((unlockedCount / achievements.length) * 100)
          : 0
    },
    targetPlayer: {
      playerId: target.player_id,
      displayName: target.display_name,
      guildCode: target.guild_code,
      role: target.role,
      isSelf
    }
  })
})
