'use client'

import { useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  AlertTriangle,
  Ban,
  Check,
  Crosshair,
  Map as MapIcon,
  Percent,
  Skull,
  Users,
  type LucideIcon
} from 'lucide-react'
import clsx from 'clsx'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { HeroUnitPortrait } from '@/app/components/ui/HeroUnitPortrait'
import { useHeroCatalog } from '@/app/lib/catalogs/heroes'
import { sortTeamUnitNamesForDisplay } from '@/app/lib/team-display-order'
import type {
  SeasonalBossCardData,
  SeasonalEncounterData,
  SeasonalHubBattleMetrics,
  SeasonalHubMetaAtlasTeam
} from '../../seasonal-hub-utils'
import { formatDamage } from './message-state'
import { bossReady } from './boss-state'

export function MiniTeam({
  units,
  compact = false
}: {
  units: string[]
  compact?: boolean
}) {
  const { data: catalog } = useHeroCatalog()
  const displayUnits = useMemo(
    () => sortTeamUnitNamesForDisplay(units, { catalog }),
    [catalog, units]
  )

  if (units.length === 0) return null
  return (
    <div
      className={
        compact
          ? 'flex min-w-0 shrink-0 items-center -space-x-1.5'
          : 'flex min-w-0 flex-wrap items-center gap-1.5'
      }
    >
      {displayUnits.slice(0, 6).map((unit) => (
        <HeroUnitPortrait
          key={unit}
          unitName={unit}
          className={
            compact ? 'h-6! w-6! ring-1 ring-(--bg-secondary)' : undefined
          }
        />
      ))}
    </div>
  )
}

// next/image serves variants sized to the painted box; keep in step with the classNames below.
const ENCOUNTER_MEDIA_SIZES =
  '(min-width: 1536px) 820px, (min-width: 1280px) calc(100vw - 560px), 100vw'

// Fixed h-16 w-16, h-20 w-20 at sm.
const SMALL_ENCOUNTER_MAP_SIZES = '80px'

export function EncounterMedia({
  encounter
}: {
  encounter: SeasonalEncounterData
}) {
  return (
    <div className="relative aspect-square w-full min-h-[156px] overflow-hidden rounded-md border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-tertiary)_45%,transparent)]">
      {encounter.mapImageUrl ? (
        <Image
          src={encounter.mapImageUrl}
          alt={`${encounter.bossName} ${encounter.boardId}`}
          fill
          sizes={ENCOUNTER_MEDIA_SIZES}
          className="object-contain"
        />
      ) : (
        <div className="flex h-full min-h-[156px] flex-col items-center justify-center gap-1 text-(--text-tertiary)">
          <MapIcon className="h-5 w-5" />
          <span className="text-xs">{encounter.boardId}</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80">
        {encounter.boardId}
      </div>
    </div>
  )
}

export function SmallEncounterMap({
  encounter
}: {
  encounter: SeasonalEncounterData
}) {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-tertiary)_45%,transparent)] sm:h-20 sm:w-20 xl:hidden">
      {encounter.mapImageUrl ? (
        <Image
          src={encounter.mapImageUrl}
          alt={`${encounter.bossName} ${encounter.boardId}`}
          fill
          sizes={SMALL_ENCOUNTER_MAP_SIZES}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-(--text-tertiary)">
          <MapIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  )
}

export function EncounterTitle({
  encounter,
  title,
  subtitle,
  href,
  children
}: {
  encounter: SeasonalEncounterData
  title: string
  subtitle?: ReactNode
  href?: string
  children?: ReactNode
}) {
  const portrait = (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-tertiary)_45%,transparent)]">
      <BossPortrait
        bossName={encounter.bossName}
        lookupName={encounter.portraitLookupName}
        size="medium"
        variant="portrait"
        priority={encounter.encounterIndex === 0}
        lazy={encounter.encounterIndex !== 0}
      />
    </div>
  )
  const heading = (
    <h3 className="truncate text-xl font-semibold text-primary-wh40k">
      {title}
    </h3>
  )
  return (
    <div className="flex min-w-0 items-center gap-3">
      {href ? (
        <Link
          href={href}
          className="shrink-0"
          aria-label={`Open ${title} playbook`}
        >
          {portrait}
        </Link>
      ) : (
        portrait
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {href ? (
            <Link href={href} className="min-w-0 hover:text-(--accent)">
              {heading}
            </Link>
          ) : (
            heading
          )}
          {children}
        </div>
        {subtitle && <div className="mt-1">{subtitle}</div>}
      </div>
    </div>
  )
}

export function MetricsStrip({
  encounter
}: {
  encounter: SeasonalEncounterData
}) {
  const avgDamage = formatDamage(encounter.battleMetrics?.averageDamage)
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <Metric label="Avg damage" value={avgDamage ?? 'No history'} />
      <Metric
        label="Total tokens"
        value={
          encounter.battleMetrics
            ? String(encounter.battleMetrics.totalTokens)
            : 'No history'
        }
      />
      <LoopTokenMetric metrics={encounter.battleMetrics} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-(--card-border) bg-black/20 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
        {label}
      </div>
      <div className="mt-1 truncate font-semibold text-primary-wh40k">
        {value}
      </div>
    </div>
  )
}

function LoopTokenMetric({
  metrics
}: {
  metrics: SeasonalHubBattleMetrics | null
}) {
  return (
    <div className="rounded-md border border-(--card-border) bg-black/20 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
        Loop tokens
      </div>
      {metrics && metrics.tokensByLoop.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {metrics.tokensByLoop.slice(0, 5).map((loop) => (
            <span
              key={loop.loopIndex}
              className="rounded-sm border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary-wh40k"
            >
              L{loop.loopIndex}: {loop.tokens}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 font-semibold text-primary-wh40k">
          No loop history
        </div>
      )}
    </div>
  )
}

export function MetaTeamBadge({ team }: { team: SeasonalHubMetaAtlasTeam }) {
  if (!team.metaTeam) return null
  return (
    <span className="inline-flex max-w-full items-center rounded-sm border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-(--accent)">
      <span className="truncate">{team.metaTeam}</span>
    </span>
  )
}

// Per-section state readable with zero taps: a value or icon, with details in the title.
function OpsIndicatorBadge({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <span
      title={`${label}: ${value}`}
      className="inline-flex items-center gap-1 rounded-md border border-(--card-border) bg-black/20 px-2 py-1 text-xs font-semibold text-secondary-wh40k"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {value}
    </span>
  )
}

function OpsBehaviourIndicator({
  behaviour,
  threshold
}: {
  behaviour: 'kill' | 'threshold' | 'skip'
  threshold?: number
}) {
  if (behaviour === 'skip') {
    return <OpsIndicatorBadge icon={Ban} label="Behaviour" value="Skipped" />
  }
  if (behaviour === 'threshold') {
    return (
      <OpsIndicatorBadge
        icon={Percent}
        label="Behaviour"
        value={`${threshold ?? 0}%`}
      />
    )
  }
  return <OpsIndicatorBadge icon={Skull} label="Behaviour" value="Kill" />
}

export function OpsSummaryRow({
  targetTokens,
  roleSet,
  behaviour,
  threshold
}: {
  targetTokens: number | null
  roleSet: boolean
  behaviour: 'kill' | 'threshold' | 'skip'
  threshold?: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <OpsIndicatorBadge
        icon={Crosshair}
        label="Target tokens"
        value={targetTokens != null ? String(targetTokens) : '—'}
      />
      <OpsIndicatorBadge
        icon={Users}
        label="Role set"
        value={roleSet ? 'Yes' : 'No'}
      />
      <OpsBehaviourIndicator behaviour={behaviour} threshold={threshold} />
    </div>
  )
}

export function StatusPill({ card }: { card: SeasonalBossCardData }) {
  const ready = bossReady(card)
  const label = ready
    ? 'All updates applied'
    : 'Please update target token allocation and/or assigned role.'
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-6 w-6 items-center justify-center rounded-full border',
        ready
          ? 'border-emerald-300/35 bg-emerald-300/10 text-emerald-300'
          : 'border-amber-300/40 bg-amber-300/10 text-amber-300'
      )}
    >
      {ready ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" />
      )}
    </span>
  )
}
