'use client'

import { createElement, useEffect, useMemo, useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { formatShortDate } from '@/app/lib/season-date/date-format'
import { useMemberLabels } from '@/app/hooks/useMemberLabels'
import {
  Activity,
  Award,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crown,
  Flame,
  Gauge,
  Medal,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  Swords,
  Trophy,
  UserRound,
  Users
} from 'lucide-react'

export interface AchievementPlayerOption {
  playerId: string
  displayName: string
  guildCode: string | null
  role: string | null
  isSelf?: boolean
  claimed?: boolean
}

interface AchievementCategory {
  key: string
  label: string
  description: string
  accentClass: string
}

interface AchievementProgress {
  current: number
  target: number
  percent: number
}

interface Achievement {
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
  progress: AchievementProgress | null
  seriesKey: string
}

interface AchievementSeries {
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
  progressToNext: number
  pointsEarned: number
  pointsAvailable: number
  allMaxed: boolean
  topRarity: string
  currentRarity: string | null
  tiers: Achievement[]
}

interface AchievementResponse {
  achievements: Achievement[]
  series: AchievementSeries[]
  categories: AchievementCategory[]
  stats: Record<string, number | boolean>
  summary: {
    total: number
    additional: number
    unlocked: number
    points: number
    completionPercent: number
  }
  targetPlayer: {
    playerId: string
    displayName: string | null
    guildCode: string | null
    role: string | null
    isSelf: boolean
  } | null
}

type StatusFilter = 'all' | 'unlocked' | 'locked'

const PAGE_SIZE = 60
const EMPTY_CATEGORIES: AchievementCategory[] = []
const EMPTY_SERIES: AchievementSeries[] = []
export const RECENT_UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000

export function isRecentAchievementUnlock(
  unlockedAt: string | null,
  nowMs = Date.now()
): boolean {
  if (!unlockedAt) return false

  const unlockedAtMs = Date.parse(unlockedAt)
  if (!Number.isFinite(unlockedAtMs)) return false

  const ageMs = nowMs - unlockedAtMs
  return ageMs >= 0 && ageMs <= RECENT_UNLOCK_WINDOW_MS
}

function useRecentAchievementUnlock(
  unlockedAt: string | null,
  enabled: boolean
): boolean {
  const [, refreshAtExpiry] = useState(0)

  useEffect(() => {
    if (!enabled || !unlockedAt) return

    const unlockedAtMs = Date.parse(unlockedAt)
    const nowMs = Date.now()
    if (
      !Number.isFinite(unlockedAtMs) ||
      !isRecentAchievementUnlock(unlockedAt, nowMs)
    ) {
      return
    }

    // Invalidate 1ms after the inclusive 24h boundary so long-lived tabs drop stale badges.
    const delayMs = unlockedAtMs + RECENT_UNLOCK_WINDOW_MS - nowMs + 1
    const timeoutId = window.setTimeout(
      () => refreshAtExpiry((version) => version + 1),
      delayMs
    )
    return () => window.clearTimeout(timeoutId)
  }, [enabled, unlockedAt])

  return enabled && isRecentAchievementUnlock(unlockedAt)
}

function getLatestUnlockedAt(tiers: Achievement[]): string | null {
  let latest: { timestamp: string; timeMs: number } | null = null

  for (const tier of tiers) {
    if (!tier.unlocked || !tier.unlockedAt) continue
    const timeMs = Date.parse(tier.unlockedAt)
    if (!Number.isFinite(timeMs)) continue
    if (!latest || timeMs > latest.timeMs) {
      latest = { timestamp: tier.unlockedAt, timeMs }
    }
  }

  return latest?.timestamp ?? null
}

const categoryIcons = {
  participation: CalendarDays,
  votlw_awards: Trophy,
  damage: Swords,
  roster_strength: Shield,
  feats_of_strength: Flame,
  activity: Activity,
  app_basics: BadgeCheck
}

const rarityClasses: Record<string, string> = {
  common: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200',
  uncommon: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  rare: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  epic: 'border-violet-400/30 bg-violet-500/10 text-violet-200',
  legendary: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  mythic: 'border-rose-400/30 bg-rose-500/10 text-rose-200'
}

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(value)

// en-US short date; shows 'recently' until mounted.
const formatDate = formatShortDate

function getCategoryIcon(category: string) {
  return categoryIcons[category as keyof typeof categoryIcons] ?? Award
}

function AchievementSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 12 }, (_, index) => (
        <div
          key={index}
          className="h-36 rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--card-bg)_70%,transparent)] animate-pulse"
        />
      ))}
    </div>
  )
}

interface StatTileProps {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}

function StatTile({ label, value, icon: Icon }: StatTileProps) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--card-bg)_80%,transparent)] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
          <Icon className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            {label}
          </p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">
            {value}
          </p>
        </div>
      </div>
    </div>
  )
}

interface AchievementsClientProps {
  initialPlayerId: string
  players: AchievementPlayerOption[]
  canSelectPlayers: boolean
  viewerGuildLabel: string | null
}

export default function AchievementsClient({
  initialPlayerId,
  players,
  canSelectPlayers,
  viewerGuildLabel
}: AchievementsClientProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState(initialPlayerId)
  const [data, setData] = useState<AchievementResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const hasMounted = useHasMounted()
  const { labelFor } = useMemberLabels()

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (selectedPlayerId) params.set('playerId', selectedPlayerId)

    fetch(`/api/player/achievements?${params.toString()}`, {
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load achievements')
        return response.json() as Promise<AchievementResponse>
      })
      .then((payload) => {
        setData(payload)
        setVisibleCount(PAGE_SIZE)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(
          err instanceof Error ? err.message : 'Unable to load achievements'
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [selectedPlayerId])

  const resetVisibleCount = () => {
    setVisibleCount(PAGE_SIZE)
  }

  const selectPlayer = (playerId: string) => {
    setLoading(true)
    setError(null)
    setData(null)
    resetVisibleCount()
    setSelectedPlayerId(playerId)
  }

  const selectCategory = (nextCategory: string) => {
    resetVisibleCount()
    setCategory(nextCategory)
  }

  const selectStatus = (nextStatus: StatusFilter) => {
    resetVisibleCount()
    setStatus(nextStatus)
  }

  const updateSearch = (nextSearch: string) => {
    resetVisibleCount()
    setSearch(nextSearch)
  }

  const selectedPlayer = useMemo(
    () => players.find((player) => player.playerId === selectedPlayerId),
    [players, selectedPlayerId]
  )

  const categories = data?.categories ?? EMPTY_CATEGORIES
  const series = data?.series ?? EMPTY_SERIES
  const unlocked = data?.summary.unlocked ?? 0
  const total = data?.summary.total ?? 0
  const points = data?.summary.points ?? 0
  const completionPercent = data?.summary.completionPercent ?? 0

  const categoryStats = useMemo(
    () =>
      categories.map((item) => {
        const categorySeries = series.filter(
          (entry) => entry.category === item.key
        )
        const tiersTotal = categorySeries.reduce(
          (sum, entry) => sum + entry.totalTiers,
          0
        )
        const tiersUnlocked = categorySeries.reduce(
          (sum, entry) => sum + entry.unlockedTiers,
          0
        )
        return {
          ...item,
          total: tiersTotal,
          unlocked: tiersUnlocked,
          percent:
            tiersTotal > 0 ? Math.round((tiersUnlocked / tiersTotal) * 100) : 0
        }
      }),
    [series, categories]
  )

  const filteredSeries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return series.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false
      if (status === 'unlocked' && entry.unlockedTiers === 0) return false
      if (status === 'locked' && entry.unlockedTiers > 0) return false
      if (!normalizedSearch) return true
      if (entry.displayName.toLowerCase().includes(normalizedSearch))
        return true
      if (entry.description.toLowerCase().includes(normalizedSearch))
        return true
      if (entry.categoryLabel.toLowerCase().includes(normalizedSearch))
        return true
      if (entry.metricLabel.toLowerCase().includes(normalizedSearch))
        return true
      return entry.tiers.some((tier) =>
        tier.displayName.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [series, category, search, status])

  const visibleSeries = filteredSeries.slice(0, visibleCount)

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <div className="border-b border-[var(--card-border)] bg-black/20 p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3 py-1 text-[var(--accent)]">
                  <Crown className="h-4 w-4" aria-hidden="true" />
                  Command
                </span>
                <span>{viewerGuildLabel ?? 'No guild'}</span>
              </div>
              <h1 className="mt-4 text-3xl font-bold text-[var(--text-primary)]">
                Achievements
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {labelFor(
                  data?.targetPlayer?.displayName || selectedPlayer?.displayName
                ) || 'Commander'}{' '}
                has unlocked {unlocked} of {total} achievements.
              </p>
            </div>

            {canSelectPlayers && players.length > 0 && (
              <label className="min-w-0 lg:w-80">
                <span className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Player
                </span>
                <select
                  value={selectedPlayerId}
                  onChange={(event) => selectPlayer(event.target.value)}
                  className="w-full rounded-md border border-[var(--card-border)] bg-black/30 px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                >
                  {players.map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {labelFor(player.displayName)}
                      {player.isSelf ? ' (you)' : ''}
                      {player.claimed === false ? ' (unclaimed)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 lg:p-6">
          <StatTile
            label="Completion"
            value={`${completionPercent}%`}
            icon={Gauge}
          />
          <StatTile
            label="Unlocked"
            value={`${formatNumber(unlocked)} / ${formatNumber(total)}`}
            icon={CheckCircle2}
          />
          <StatTile
            label="Score"
            value={formatNumber(points)}
            icon={Sparkles}
          />
          <StatTile
            label="Catalog"
            value={`${formatNumber(data?.summary.additional ?? 0)} new`}
            icon={Medal}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {categoryStats.map((item) => {
          const Icon = getCategoryIcon(item.key)
          const active = category === item.key
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => selectCategory(active ? 'all' : item.key)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                active
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'border-[var(--card-border)] bg-[color-mix(in_srgb,var(--card-bg)_70%,transparent)] hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5">
                  <Icon
                    className="h-4 w-4 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[var(--text-primary)]">
                      {item.label}
                    </p>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {item.percent}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    {item.unlocked} / {item.total}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--card-bg)_80%,transparent)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <input
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Search achievements"
              className="w-full rounded-md border border-[var(--card-border)] bg-black/30 py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {(['all', 'unlocked', 'locked'] as StatusFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={status === item}
                onClick={() => selectStatus(item)}
                className={`rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  status === item
                    ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                    : 'border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {item}
              </button>
            ))}
            {category !== 'all' && (
              <button
                type="button"
                onClick={() => selectCategory('all')}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--card-border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && <AchievementSkeleton />}

      {!loading && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">
          {error}
        </div>
      )}

      {!loading && !error && filteredSeries.length === 0 && (
        <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--card-bg)_80%,transparent)] p-8 text-center">
          <UserRound
            className="mx-auto h-8 w-8 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium text-[var(--text-primary)]">
            No achievements match this view.
          </p>
        </div>
      )}

      {!loading && !error && visibleSeries.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleSeries.map((entry) => (
            <SeriesCard
              key={entry.seriesKey}
              series={entry}
              hasMounted={hasMounted}
            />
          ))}
        </div>
      )}

      {!loading && !error && visibleCount < filteredSeries.length && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="rounded-md border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
          >
            Load more ({filteredSeries.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

interface SeriesCardProps {
  series: AchievementSeries
  hasMounted: boolean
}

function SeriesCard({ series, hasMounted }: SeriesCardProps) {
  const [expanded, setExpanded] = useState(false)
  const tiersUnlocked = series.unlockedTiers
  const tiersTotal = series.totalTiers
  const hasProgress = tiersUnlocked > 0
  const isMaxed = series.allMaxed
  const rarityForBadge =
    series.currentRarity ?? series.tiers[0]?.rarity ?? 'common'
  const latestUnlockedAt = getLatestUnlockedAt(series.tiers)
  const lastUnlockedAt = formatDate(latestUnlockedAt, hasMounted)
  const isJustUnlocked = useRecentAchievementUnlock(
    latestUnlockedAt,
    hasMounted
  )

  return (
    <article
      aria-label={`${series.displayName} achievement`}
      className={`relative rounded-lg border p-4 transition-transform hover:-translate-y-0.5 ${
        isMaxed
          ? 'border-amber-400/60 bg-amber-500/10'
          : hasProgress
            ? 'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
            : 'border-[var(--card-border)] bg-[color-mix(in_srgb,var(--card-bg)_80%,transparent)]'
      } ${
        isJustUnlocked
          ? 'motion-safe:animate-[achievement-glow_3s_ease-in-out_3]'
          : ''
      }`}
    >
      {isJustUnlocked && (
        <Sparkles
          className="absolute -right-1.5 -top-1.5 h-4 w-4 text-amber-300 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)] motion-safe:animate-[pulse_2s_ease-in-out_3]"
          aria-hidden="true"
        />
      )}
      <div className="flex items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
            isMaxed
              ? 'border-amber-300/60 bg-amber-500/15'
              : hasProgress
                ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-black/20'
                : 'border-white/10 bg-black/20 opacity-70'
          }`}
        >
          {isMaxed ? (
            <Star className="h-5 w-5 text-amber-300" aria-hidden="true" />
          ) : (
            createElement(getCategoryIcon(series.category), {
              className: `h-5 w-5 ${
                hasProgress
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-secondary)]'
              }`,
              'aria-hidden': true
            })
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                rarityClasses[rarityForBadge] ?? rarityClasses.common
              }`}
            >
              {hasProgress ? `Tier ${tiersUnlocked}` : 'Locked'}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {series.categoryLabel}
            </span>
            {isMaxed && (
              <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                Maxed
              </span>
            )}
            {isJustUnlocked && (
              <span className="rounded-full border border-amber-300/50 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-100">
                Just unlocked
              </span>
            )}
          </div>
          <h2 className="mt-2 text-base font-semibold leading-snug text-[var(--text-primary)]">
            {series.displayName}
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
            {series.description}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
          <span>
            {tiersUnlocked} / {tiersTotal} tiers
          </span>
          <span>
            {isMaxed
              ? `Maxed at ${formatNumber(
                  series.tiers[series.tiers.length - 1]?.threshold ?? 0
                )}`
              : `${formatNumber(series.currentValue)} / ${formatNumber(
                  series.nextThreshold ?? 0
                )}`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${
              isMaxed
                ? 'bg-amber-400'
                : hasProgress
                  ? 'bg-[var(--accent)]'
                  : 'bg-[var(--text-secondary)]'
            }`}
            style={{
              width: `${isMaxed ? 100 : series.progressToNext}%`
            }}
          />
        </div>
      </div>

      <TierLadder series={series} />

      <div className="mt-4 flex items-center justify-between gap-3 text-xs">
        <span className="text-[var(--text-secondary)]">
          {series.pointsEarned} / {series.pointsAvailable} pts
        </span>
        {hasProgress ? (
          <span className="inline-flex items-center gap-1 text-[var(--accent)]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {lastUnlockedAt ? `Last unlock ${lastUnlockedAt}` : 'Unlocked'}
          </span>
        ) : (
          <span className="text-[var(--text-secondary)]">Locked</span>
        )}
      </div>

      {series.tiers.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
              Hide tiers
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              Show all {series.tiers.length} tiers
            </>
          )}
        </button>
      )}

      {expanded && (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1 text-xs">
          {series.tiers.map((tier, index) => (
            <li
              key={tier.key}
              className={`flex items-center justify-between gap-3 rounded-md border px-2 py-1 ${
                tier.unlocked
                  ? 'border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--text-primary)]'
                  : 'border-[var(--card-border)] text-[var(--text-secondary)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
                    tier.unlocked
                      ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]'
                      : 'border-white/15 text-[var(--text-secondary)]'
                  }`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="truncate">{tier.displayName}</span>
              </span>
              <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                <span>{formatNumber(tier.threshold ?? 0)}</span>
                <span
                  className={`rounded-full border px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide ${
                    rarityClasses[tier.rarity] ?? rarityClasses.common
                  }`}
                >
                  {tier.rarity}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

interface TierLadderProps {
  series: AchievementSeries
}

function TierLadder({ series }: TierLadderProps) {
  // Cap ladder dots so a 180-tier series fits the card.
  const MAX_DOTS = 12
  const tiers = series.tiers
  const step = Math.max(1, Math.ceil(tiers.length / MAX_DOTS))
  const sampled: Array<{ index: number; tier: Achievement }> = []
  for (let i = 0; i < tiers.length; i += step) {
    const tier = tiers[i]
    if (tier) sampled.push({ index: i, tier })
  }
  // Always include the final tier so "maxed" is clear.
  const last = tiers.length - 1
  if (last >= 0 && sampled[sampled.length - 1]?.index !== last) {
    const tier = tiers[last]
    if (tier) sampled.push({ index: last, tier })
  }
  if (sampled.length <= 1) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1">
      {sampled.map(({ index, tier }) => (
        <span
          key={tier.key}
          title={`${tier.displayName} — ${formatNumber(tier.threshold ?? 0)}`}
          className={`h-2 w-2 rounded-full border ${
            tier.unlocked
              ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[var(--accent)]'
              : 'border-white/15 bg-white/5'
          }`}
          aria-label={`Tier ${index + 1}${tier.unlocked ? ' unlocked' : ''}`}
        />
      ))}
    </div>
  )
}
