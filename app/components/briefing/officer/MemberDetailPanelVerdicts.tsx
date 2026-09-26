'use client'

import { ArrowRight } from 'lucide-react'
import { formatDamage } from '@tacticus/app-core/formatters'
import { formatEncounterLabel } from '@/app/lib/format/encounter-label'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import {
  SwapChips,
  CONFIDENCE_LABEL,
  CLASSIFICATION_META
} from '@/app/components/briefing/officer/SwapChips'
import type {
  MemberBossVerdict,
  MemberClassification,
  Confidence,
  RecentAttackPoint
} from '@/app/lib/officer-briefing/types'

export type HeroIconMap = Map<string, string>

function ClassificationBadge({
  classification,
  confidence
}: {
  classification: MemberClassification
  confidence: Confidence
}) {
  const meta = CLASSIFICATION_META[classification]
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: meta.color, borderColor: meta.color }}
      >
        {meta.label}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
        {CONFIDENCE_LABEL[confidence]}
      </span>
    </span>
  )
}

/** Small hero icon row; falls back to a 3-letter name chip when no icon maps. */
function HeroIconRow({
  heroes,
  mow,
  iconMap
}: {
  heroes: string[]
  mow: string | null
  iconMap: HeroIconMap
}) {
  const resolve = (name: string): string | null =>
    iconMap.get(name) ?? iconMap.get(name.toLowerCase()) ?? null

  if (heroes.length === 0 && !mow) {
    return (
      <span className="text-[11px] italic text-[var(--text-tertiary)]">
        unknown
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {heroes.map((hero) => {
        const icon = resolve(hero)
        return icon ? (
          <img
            key={`hero-${hero}`}
            src={icon}
            alt={hero}
            title={hero}
            loading="lazy"
            className="h-10 w-10 rounded"
          />
        ) : (
          <span
            key={`hero-${hero}`}
            title={hero}
            className="rounded bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-secondary)]"
          >
            {hero.slice(0, 3)}
          </span>
        )
      })}
      {mow && (
        <>
          <span className="mx-0.5 text-[10px] text-[var(--text-tertiary)]">
            +
          </span>
          {(() => {
            const icon = resolve(mow)
            return icon ? (
              <img
                key={`mow-${mow}`}
                src={icon}
                alt={mow}
                title={`${mow} (MoW)`}
                loading="lazy"
                className="h-10 w-10 rounded ring-1 ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
              />
            ) : (
              <span
                key={`mow-${mow}`}
                title={`${mow} (MoW)`}
                className="rounded bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent)]"
              >
                {mow.slice(0, 3)}
              </span>
            )
          })()}
        </>
      )}
    </div>
  )
}

function surfacingNarrative(verdict: MemberBossVerdict): string {
  const target = getBossDisplayName(verdict.bossName)
  const upside =
    verdict.readyNowUpside != null && verdict.readyNowUpside > 0
      ? `~${formatDamage(verdict.readyNowUpside, 0)}/attack of recoverable damage`
      : null
  const evidence = `${verdict.battleCount} attack${verdict.battleCount === 1 ? '' : 's'}`

  switch (verdict.classification) {
    case 'needs_support_wrong_team':
      return upside
        ? `Underperforming on ${target} with a stronger team already fieldable — ${upside} (over ${evidence}).`
        : `A stronger team is already fieldable for ${target} (over ${evidence}).`
    case 'needs_support_correct_team':
      return `On their current best fieldable team for ${target} but below expectation — an execution gap (over ${evidence}).`
    case 'doing_great':
      return `Materially above their roster-adjusted expectation on ${target} (over ${evidence}).`
    case 'roster_limited':
      return `Below average on ${target}, but no stronger team is fieldable — no coaching task (over ${evidence}).`
    case 'insufficient_data':
    default:
      return `Too few attacks to judge ${target} yet (${evidence}).`
  }
}

function StatBlock({
  label,
  value,
  color,
  sub
}: {
  label: string
  value: string
  color?: string
  sub?: string | null
}) {
  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </p>
      <p
        className="text-lg font-bold tabular-nums"
        style={{ color: color ?? 'var(--text-primary)' }}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-[var(--text-tertiary)]">{sub}</p>}
    </div>
  )
}

/** Per-attack bars against the constant population-estimate expectation line. */
function RecentAttacksChart({ points }: { points: RecentAttackPoint[] }) {
  if (points.length === 0) return null
  const expected = points.find((p) => p.expected != null)?.expected ?? null
  const max = Math.max(...points.map((p) => p.damage), expected ?? 0)
  if (max <= 0) return null

  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          Recent attacks vs roster expectation
        </p>
        {expected != null && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            <span
              className="mr-1 inline-block w-4 border-t border-dashed align-middle"
              style={{ borderColor: 'var(--text-tertiary)' }}
              aria-hidden
            />
            expected {formatDamage(expected, 0)}
          </span>
        )}
      </div>
      <div
        className="relative flex h-24 items-end gap-2"
        role="img"
        aria-label={`${points.length} recent attacks vs an expected ${
          expected != null ? formatDamage(expected, 0) : 'unavailable value'
        }`}
      >
        {expected != null && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed"
            style={{
              bottom: `${(expected / max) * 100}%`,
              borderColor:
                'color-mix(in srgb, var(--text-tertiary) 70%, transparent)'
            }}
            aria-hidden
          />
        )}
        {points.map((p, i) => {
          const below = expected != null && p.damage < expected
          const barColor =
            expected == null
              ? 'color-mix(in srgb, var(--text-tertiary) 55%, transparent)'
              : below
                ? 'color-mix(in srgb, var(--danger) 75%, transparent)'
                : 'color-mix(in srgb, var(--success) 75%, transparent)'
          return (
            <div
              key={`${p.startedAt}:${p.damage}`}
              className="flex h-full flex-1 flex-col items-center justify-end"
            >
              <div
                className="w-full max-w-[36px] rounded-t"
                title={`${formatDamage(p.damage, 0)} · ${p.startedAt.slice(0, 16).replace('T', ' ')}`}
                style={{
                  height: `${Math.max(3, (p.damage / max) * 100)}%`,
                  backgroundColor: barColor
                }}
              />
              <span className="mt-1 text-[9px] uppercase text-[var(--text-tertiary)]">
                A{i + 1}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function HeadlineVerdict({
  verdict,
  iconMap,
  recentAttacks
}: {
  verdict: MemberBossVerdict
  iconMap: HeroIconMap
  recentAttacks: RecentAttackPoint[]
}) {
  const meta = CLASSIFICATION_META[verdict.classification]
  const upside = verdict.readyNowUpside

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <BossPortrait
            bossName={getBossDisplayName(verdict.bossName)}
            size="small"
            variant="icon"
            lazy={false}
            className="shrink-0"
          />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              {getBossDisplayName(verdict.bossName)}
              {formatEncounterLabel(verdict.encounterId, 'dot')}
              {verdict.rarity ? ` · ${verdict.rarity}` : ''}
            </p>
            <ClassificationBadge
              classification={verdict.classification}
              confidence={verdict.confidence}
            />
          </div>
        </div>
      </div>

      {/* Why this person surfaced */}
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          Why this person was surfaced
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          {surfacingNarrative(verdict)}
        </p>
      </div>

      {/* Stat pair: ready-now upside / evidence (target score is in the header). */}
      <div className="grid grid-cols-2 gap-2">
        <StatBlock
          label="Ready-now upside"
          value={
            upside != null && upside > 0 && !meta.muted
              ? `+${formatDamage(upside, 0)}`
              : '—'
          }
          color={
            upside != null && upside > 0 && !meta.muted
              ? 'var(--accent)'
              : undefined
          }
          sub="per attack"
        />
        <StatBlock
          label="Evidence"
          value={`${verdict.battleCount}`}
          sub={`attack${verdict.battleCount === 1 ? '' : 's'}`}
        />
      </div>

      {/* Ready-now upside — explicitly labeled as a population-average estimate. */}
      {upside != null && upside > 0 && !meta.muted && (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Ready-now upside is a population-average estimate, not a guarantee.
        </p>
      )}

      {/* Roster-supported context: team used → best fieldable, hero icons. */}
      <div className="space-y-2 rounded-md border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Roster-supported team context
          </p>
          <span className="flex items-center gap-2">
            {verdict.swaps.length > 0 && (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {verdict.swaps.length} swap
                {verdict.swaps.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="space-y-1">
            <p className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Team used
            </p>
            <HeroIconRow
              heroes={verdict.teamUsed?.heroes ?? []}
              mow={verdict.teamUsed?.mow ?? null}
              iconMap={iconMap}
            />
          </div>
          <ArrowRight className="h-4 w-4 text-[var(--accent)]" aria-hidden />
          <div className="space-y-1">
            <p className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Best fieldable context
            </p>
            <HeroIconRow
              heroes={verdict.bestFieldable?.heroes ?? []}
              mow={verdict.bestFieldable?.mow ?? null}
              iconMap={iconMap}
            />
          </div>
        </div>

        {/* One decimal: with 0, M-band values round to whole millions and understate the gain. */}
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span className="text-[var(--text-secondary)]">
            {verdict.actualAvg != null
              ? formatDamage(verdict.actualAvg, 1)
              : '—'}
          </span>
          <ArrowRight
            className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
            aria-hidden
          />
          <span className="font-semibold text-[var(--text-primary)]">
            {verdict.expectedForBestFieldable != null
              ? formatDamage(verdict.expectedForBestFieldable, 1)
              : '—'}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            avg / attack
          </span>
        </div>

        <SwapChips swaps={verdict.swaps} />

        {(verdict.bestFieldable?.heroes.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)]">
            <span>
              Uses {verdict.bestFieldable!.heroes.length} owned character
              {verdict.bestFieldable!.heroes.length === 1 ? '' : 's'} at
              eligible power.
            </span>
            <span style={{ color: 'var(--success)' }}>Fieldable now</span>
          </div>
        )}
      </div>

      {/* Per-attack history vs the roster expectation. */}
      <RecentAttacksChart points={recentAttacks} />

      {/* Recommended officer action — muted for roster_limited / insufficient. */}
      <div className="rounded-md border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] p-3">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          Recommended officer action
        </p>
        <p
          className="text-sm"
          style={{
            color: meta.muted ? 'var(--text-tertiary)' : 'var(--text-primary)'
          }}
        >
          {verdict.recommendation}
        </p>
      </div>
    </div>
  )
}

export function CompactVerdictRow({ verdict }: { verdict: MemberBossVerdict }) {
  const meta = CLASSIFICATION_META[verdict.classification]
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[var(--text-primary)]">
          {getBossDisplayName(verdict.bossName)}
          {verdict.encounterId > 0 ? ` · P${verdict.encounterId}` : ''}
        </p>
        <p className="truncate text-[10px] text-[var(--text-tertiary)]">
          {verdict.actualAvg != null ? formatDamage(verdict.actualAvg, 0) : '—'}{' '}
          avg
          {' · '}
          {CONFIDENCE_LABEL[verdict.confidence]}
        </p>
      </div>
      <span
        className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
        style={{ color: meta.color, borderColor: meta.color }}
      >
        {meta.label}
      </span>
    </li>
  )
}
