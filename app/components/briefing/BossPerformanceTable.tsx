'use client'

/**
 * Per-boss damage-per-token bullet bars. YOUR TARGET is the playbook target, else the
 * coaching estimate, else the guild average, with a source chip.
 */

import { ChromeLink as Link } from '@/app/components/navigation/ChromeLink'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import { getPlaybookId } from '@/app/lib/boss-playbooks/playbook-id'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { prettyBossName } from '@/app/lib/loki/boss-display'
import { formatEncounterLabel } from '@/app/lib/format/encounter-label'
import type {
  MemberBossPerformance,
  MemberBossPerfRow
} from '@/app/lib/briefing/load-member-boss-performance'

interface BossPerformanceTableProps {
  data: MemberBossPerformance
  seasonNumber: string | null
}

function dmg(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}K`
  return `${Math.round(n)}`
}

function pct(n: number | null): string {
  if (n == null) return ''
  const r = Math.round(n)
  return `${r >= 0 ? '+' : ''}${r}%`
}

function deltaColor(n: number | null): string {
  if (n == null) return 'var(--text-tertiary)'
  if (n >= 1) return 'var(--success)'
  if (n <= -1) return 'var(--danger)'
  return 'var(--text-secondary)'
}

const SOURCE_LABEL: Record<MemberBossPerfRow['targetSource'], string> = {
  playbook: 'Playbook',
  coaching: 'Coaching',
  guild: 'Guild avg'
}

function SourceChip({ source }: { source: MemberBossPerfRow['targetSource'] }) {
  const isPlaybook = source === 'playbook'
  return (
    <span
      className="rounded-sm border px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider"
      style={{
        color: isPlaybook ? 'var(--accent)' : 'var(--text-tertiary)',
        borderColor: isPlaybook
          ? 'color-mix(in srgb, var(--accent) 55%, transparent)'
          : 'var(--card-border)',
        backgroundColor: isPlaybook
          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
          : 'transparent'
      }}
    >
      {SOURCE_LABEL[source]}
    </span>
  )
}

/** Shared by the mobile card and desktop row so they cannot drift. */
function BossIdentity({ row }: { row: MemberBossPerfRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BossPortrait
        bossName={row.bossName}
        variant="icon"
        size="small"
        showFallback
        className="shrink-0 rounded-md border border-(--card-border)"
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-primary-wh40k group-hover:underline">
          {prettyBossName(row.bossName)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
          {row.isCurrentTarget ? 'Current target · ' : ''}
          {formatEncounterLabel(row.encounterId)}
        </div>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  emphasis,
  delta,
  deltaTextColor,
  chip
}: {
  label: string
  value: string
  emphasis?: boolean
  delta?: string | null
  deltaTextColor?: string
  chip?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[color-mix(in_srgb,var(--card-border)_40%,transparent)] bg-card/20 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-(--text-tertiary)">
        <span className="truncate">{label}</span>
        {chip && <span className="shrink-0">{chip}</span>}
      </div>
      <div
        className={`mt-0.5 font-mono tabular-nums ${
          emphasis ? 'font-semibold text-primary-wh40k' : 'text-secondary-wh40k'
        }`}
      >
        {value}
        {delta && (
          <span
            className="ml-1 text-[11px] font-semibold"
            style={{ color: deltaTextColor }}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  )
}

function MarkSwatch({
  kind,
  below
}: {
  kind: 'avg' | 'target' | 'guild'
  below?: boolean
}) {
  if (kind === 'avg') {
    return (
      <span
        className="inline-block h-2.5 w-3.5 shrink-0 rounded-xs"
        style={{ backgroundColor: below ? 'var(--warning)' : 'var(--success)' }}
        aria-hidden="true"
      />
    )
  }
  if (kind === 'target') {
    return (
      <span
        className="inline-block h-3.5 w-[3px] shrink-0 rounded-xs"
        style={{ backgroundColor: 'var(--accent)' }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="inline-block h-3.5 w-0 shrink-0"
      style={{
        borderLeft:
          '2px dashed color-mix(in srgb, var(--text-primary) 42%, transparent)'
      }}
      aria-hidden="true"
    />
  )
}

/** Per-row scale: position vs this boss's target and guild, not across bosses. */
function posOf(value: number | null, rowMax: number): number | null {
  if (value == null || value <= 0 || rowMax <= 0) return null
  return Math.min(100, (value / rowMax) * 100)
}

/** Unmapped names (prime lore names) fall back to the gallery so no row is a dead click. */
function playbookHref(
  row: MemberBossPerfRow,
  seasonNumber: string | null
): string {
  const id = getPlaybookId(prettyBossName(row.bossName))
  return getHrefWithSeason(
    id ? `/boss-playbooks/${id}` : '/boss-playbooks',
    seasonNumber
  )
}

// Hover tint and focus ring via properties that do not fight the inline background.
const ROW_LINK_CHROME =
  'group transition-shadow hover:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.09)] ' +
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--accent) ' +
  'focus-visible:-outline-offset-2'

function BulletRow({
  row,
  seasonNumber
}: {
  row: MemberBossPerfRow
  seasonNumber: string | null
}) {
  const vals = [row.guildAvg, row.yourTarget, row.yourAvg].filter(
    (v): v is number => v != null && v > 0
  )
  const rowMax = vals.length ? Math.max(...vals) * 1.1 : 1
  const fillPos = posOf(row.yourAvg, rowMax)
  const targetPos = posOf(row.yourTarget, rowMax)
  const guildPos = posOf(row.guildAvg, rowMax)
  const belowTarget =
    row.yourAvg != null &&
    row.yourTarget != null &&
    row.yourAvg < row.yourTarget

  return (
    <Link
      href={playbookHref(row, seasonNumber)}
      className={`${ROW_LINK_CHROME} grid grid-cols-[minmax(150px,200px)_1fr_minmax(172px,auto)] items-center gap-4 px-4 py-2.5`}
      style={
        row.isCurrentTarget
          ? { backgroundColor: 'rgba(var(--card-bg-rgb), 0.5)' }
          : undefined
      }
    >
      <BossIdentity row={row} />

      <div
        className="relative h-6 overflow-visible rounded-md"
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--card-border) 40%, transparent)'
        }}
        role="img"
        aria-label={`${prettyBossName(row.bossName)}: your ${dmg(
          row.yourAvg
        )}, ${SOURCE_LABEL[row.targetSource].toLowerCase()} target ${dmg(
          row.yourTarget
        )}, guild ${dmg(row.guildAvg)}, ${pct(row.vsTargetPct)} vs target`}
      >
        {fillPos != null && (
          <div
            className="absolute inset-y-0 left-0 rounded-md"
            style={{
              width: `${fillPos}%`,
              backgroundColor: belowTarget
                ? 'var(--warning)'
                : 'var(--success)',
              boxShadow: 'inset -2px 0 0 rgba(255,255,255,0.28)'
            }}
          />
        )}
        {guildPos != null && (
          <div
            className="absolute -inset-y-0.5"
            style={{
              left: `${guildPos}%`,
              transform: 'translateX(-50%)',
              borderLeft:
                '2px dashed color-mix(in srgb, var(--text-primary) 42%, transparent)'
            }}
            aria-hidden="true"
          />
        )}
        {targetPos != null && (
          <div
            className="absolute -inset-y-0.5 w-[3px] rounded-xs"
            style={{
              left: `${targetPos}%`,
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--accent)',
              boxShadow:
                '0 0 0 1px color-mix(in srgb, var(--text-primary) 22%, transparent)'
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Each readout row carries its bar mark, mapping 1:1. */}
      <div className="flex flex-col gap-0.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {row.yourAvg != null ? (
            <MarkSwatch kind="avg" below={belowTarget} />
          ) : (
            <span
              className="inline-block h-2.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
          )}
          <span className="w-9 text-left text-[9px] uppercase tracking-wider text-(--text-tertiary)">
            You
          </span>
          <span className="font-mono tabular-nums text-[14px] font-bold text-primary-wh40k">
            {dmg(row.yourAvg)}
          </span>
          {row.vsTargetPct != null && (
            <span
              className="w-11 font-mono tabular-nums text-[11px] font-bold"
              style={{ color: deltaColor(row.vsTargetPct) }}
            >
              {pct(row.vsTargetPct)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <MarkSwatch kind="target" />
          <span className="w-9 text-left text-[9px] uppercase tracking-wider text-(--text-tertiary)">
            Target
          </span>
          <span className="font-mono tabular-nums text-[12px] font-semibold text-(--accent)">
            {dmg(row.yourTarget)}
          </span>
          <span className="w-11 text-left">
            <SourceChip source={row.targetSource} />
          </span>
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <MarkSwatch kind="guild" />
          <span className="w-9 text-left text-[9px] uppercase tracking-wider text-(--text-tertiary)">
            Guild
          </span>
          <span className="font-mono tabular-nums text-[12px] text-secondary-wh40k">
            {dmg(row.guildAvg)}
          </span>
          <span className="w-11" />
        </div>
      </div>
      <span className="sr-only"> — open playbook</span>
    </Link>
  )
}

export default function BossPerformanceTable({
  data,
  seasonNumber
}: BossPerformanceTableProps) {
  if (data.rows.length === 0) return null

  const currentTarget = data.rows.find((r) => r.isCurrentTarget)

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 overflow-hidden"
      aria-label="Boss performance"
      data-testid="boss-performance-table"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-primary-wh40k">
            Boss performance
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
            Damage per token{seasonNumber ? ` · Season ${seasonNumber}` : ''}
          </span>
          {data.overallVsGuildPct != null && (
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
              style={{
                color: deltaColor(data.overallVsGuildPct),
                borderColor: deltaColor(data.overallVsGuildPct)
              }}
            >
              {pct(data.overallVsGuildPct)} vs guild
            </span>
          )}
        </div>
        <Link
          href={getHrefWithSeason('/player-stats', seasonNumber)}
          className="text-xs text-(--accent) hover:underline"
        >
          View all performance →
        </Link>
      </header>

      {/* Legend for the bar marks (desktop only). */}
      <div className="hidden flex-wrap items-center gap-4 border-b border-[color-mix(in_srgb,var(--card-border)_30%,transparent)] px-4 py-2 text-[11px] text-secondary-wh40k sm:flex">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-5 rounded-xs"
            style={{ backgroundColor: 'var(--success)' }}
          />
          Your avg
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-[3px] rounded-xs"
            style={{ backgroundColor: 'var(--accent)' }}
          />
          Clear target{' '}
          <span className="text-(--text-tertiary)">
            (playbook HP ÷ tokens, or coaching)
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3.5"
            style={{
              borderLeft:
                '2px dashed color-mix(in srgb, var(--text-primary) 42%, transparent)'
            }}
          />
          Guild avg
        </span>
      </div>

      {/* Below 640px: stacked cards with a 3-up metric grid, no horizontal scroll. */}
      <div className="divide-y divide-[color-mix(in_srgb,var(--card-border)_30%,transparent)] sm:hidden">
        {data.rows.map((r) => (
          <Link
            key={`${r.bossName}-${r.encounterId}-card`}
            href={playbookHref(r, seasonNumber)}
            className={`${ROW_LINK_CHROME} block px-4 py-3`}
            style={
              r.isCurrentTarget
                ? { backgroundColor: 'rgba(var(--card-bg-rgb), 0.5)' }
                : undefined
            }
          >
            <BossIdentity row={r} />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MetricTile label="Guild avg" value={dmg(r.guildAvg)} />
              <MetricTile
                label="Target"
                value={dmg(r.yourTarget)}
                chip={<SourceChip source={r.targetSource} />}
              />
              <MetricTile
                label="Your avg"
                value={dmg(r.yourAvg)}
                emphasis
                delta={r.vsTargetPct != null ? pct(r.vsTargetPct) : null}
                deltaTextColor={deltaColor(r.vsTargetPct)}
              />
            </div>
            <span className="sr-only"> — open playbook</span>
          </Link>
        ))}
      </div>

      {/* Desktop (≥640px): per-boss bullet bars. */}
      <div className="hidden divide-y divide-[color-mix(in_srgb,var(--card-border)_30%,transparent)] sm:block">
        {data.rows.map((r) => (
          <BulletRow
            key={`${r.bossName}-${r.encounterId}`}
            row={r}
            seasonNumber={seasonNumber}
          />
        ))}
      </div>

      {currentTarget && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-2.5 text-xs text-secondary-wh40k">
          <span>
            <span className="font-semibold text-primary-wh40k">
              Current target: {prettyBossName(currentTarget.bossName)}
            </span>{' '}
            — you are{' '}
            {(currentTarget.vsTargetPct ?? 0) >= 0 ? 'above' : 'below'} target
            here.
            {data.strongestAlternate
              ? ` If the directive changes, ${prettyBossName(data.strongestAlternate)} is your strongest proven alternate.`
              : ''}
          </span>
          <Link
            href={getHrefWithSeason('/boss-playbooks', seasonNumber)}
            className="text-(--accent) hover:underline"
          >
            All bosses →
          </Link>
        </footer>
      )}
    </section>
  )
}
