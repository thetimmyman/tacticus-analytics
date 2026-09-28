'use client'

import { memo } from 'react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import {
  buildCumulativeFeasibility,
  reachableStageIndex,
  stageBudgetTokens,
  stageHasOfficerTarget
} from '@/app/lib/season-forecast/boss-feasibility-math'

interface BossFeasibilityTableProps {
  sequence: BossStageEntry[]
  /** Projected spendable tokens by season end; marks how far the guild can reach. */
  tokensSpendable?: number | null
}

const DIFFICULTY_CLASS: Record<BossStageEntry['difficulty'], string> = {
  easy: 'text-green-400',
  medium: 'text-amber-300',
  hard: 'text-red-400'
}

/** Officer-skipped primes show "Skipped" instead of silently shrinking totals. */
function PrimesCell({ entry }: { entry: BossStageEntry }) {
  const primes = [entry.encounters.prime1, entry.encounters.prime2].filter(
    (prime): prime is NonNullable<typeof prime> => prime != null
  )
  const skippedCount = primes.filter((prime) => prime.skipped === true).length
  const activeCount = primes.length - skippedCount
  return (
    <>
      {activeCount > 0 ? `+${activeCount}` : '—'}
      {skippedCount > 0 && (
        <span className="ml-1 text-[10px] uppercase tracking-wide text-(--text-tertiary)">
          {skippedCount} Skipped
        </span>
      )}
    </>
  )
}

interface FeasibilityRow {
  entry: BossStageEntry
  cumulative: number
  outOfReach: boolean
}

const stageKey = (entry: BossStageEntry) =>
  `${entry.stageCode}-${entry.loopIndex}`

// Primary colour is explicit because DataTable's `<td>` forces `text-secondary`.
const renderStageCell = (entry: BossStageEntry) => (
  <>
    {entry.stageCode}
    <span className="text-(--text-tertiary)"> L{entry.loopIndex}</span>
    {entry.isCurrentStage && (
      <span className="ml-1 text-[10px] text-(--accent)">now</span>
    )}
  </>
)

const renderBossCell = (entry: BossStageEntry) => (
  <span className="text-primary-wh40k">
    {getBossDisplayName(entry.encounters.main.bossName)}
  </span>
)

const renderHpCell = (entry: BossStageEntry) => (
  <span className="text-primary-wh40k">
    {formatNumber(entry.encounters.main.remainingHp)} /{' '}
    {formatNumber(entry.encounters.main.maxHp)}
  </span>
)

const LOW_CONFIDENCE_COLUMNS: DataTableColumn<BossStageEntry>[] = [
  {
    key: 'stage',
    header: 'Stage',
    sortable: false,
    render: renderStageCell
  },
  { key: 'boss', header: 'Boss', sortable: false, render: renderBossCell },
  {
    key: 'remainingHp',
    header: 'Remaining HP',
    sortable: false,
    render: renderHpCell
  },
  {
    key: 'primes',
    header: 'Primes',
    sortable: false,
    render: (entry) => <PrimesCell entry={entry} />
  }
]

/** Never sorted: the rotation order is the data. */
function buildFeasibilityColumns(
  hasOfficerTargets: boolean
): DataTableColumn<FeasibilityRow>[] {
  return [
    {
      key: 'stage',
      header: 'Stage',
      sortable: false,
      render: ({ entry }) => renderStageCell(entry)
    },
    {
      key: 'boss',
      header: 'Boss',
      sortable: false,
      render: ({ entry }) => renderBossCell(entry)
    },
    {
      key: 'remainingHp',
      header: 'Remaining HP',
      sortable: false,
      render: ({ entry }) => renderHpCell(entry)
    },
    {
      key: 'primes',
      header: 'Primes',
      sortable: false,
      render: ({ entry }) => <PrimesCell entry={entry} />
    },
    {
      // With targets: source-labelled with variance, e.g. "Target 20 · est 26 (+6)".
      key: 'budget',
      header: hasOfficerTargets ? 'Budget' : 'Est. tokens',
      sortable: false,
      render: ({ entry }) => (
        <span className="text-primary-wh40k">
          {!hasOfficerTargets ? (
            formatNumber(entry.estimatedTokensNeeded)
          ) : stageHasOfficerTarget(entry) ? (
            <>
              Target {formatNumber(stageBudgetTokens(entry))}
              {typeof entry.budgetVarianceTokens === 'number' &&
                entry.budgetVarianceTokens !== 0 && (
                  <span className="ml-1 text-xs text-secondary-wh40k">
                    · est {formatNumber(entry.estimatedTokensNeeded)} (
                    {entry.budgetVarianceTokens > 0 ? '+' : ''}
                    {formatNumber(entry.budgetVarianceTokens)})
                  </span>
                )}
            </>
          ) : (
            <>Est {formatNumber(stageBudgetTokens(entry))}</>
          )}
        </span>
      )
    },
    {
      key: 'cumulative',
      header: 'Cumulative',
      sortable: false,
      render: ({ cumulative }) => (
        <span className="font-semibold text-(--accent)">
          {formatNumber(cumulative)}
        </span>
      )
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      sortable: false,
      render: ({ entry }) => (
        <span className={`capitalize ${DIFFICULTY_CLASS[entry.difficulty]}`}>
          {entry.difficulty}
        </span>
      )
    }
  ]
}

function BossFeasibilityTable({
  sequence,
  tokensSpendable
}: BossFeasibilityTableProps) {
  if (sequence.length === 0) return null

  const hasOfficerTargets = sequence.some(stageHasOfficerTarget)

  // No history gives 0 tokens / 'hard' everywhere, a contradiction: show low confidence instead.
  const hasDamageSignal = sequence.some((entry) => stageBudgetTokens(entry) > 0)

  if (!hasDamageSignal) {
    return (
      <div className="rounded-lg border border-(--card-border) bg-card/40 p-4">
        <h4 className="text-sm font-semibold text-primary-wh40k">
          Remaining boss feasibility
        </h4>
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Not enough recent attack history to estimate token cost or difficulty
          yet. The remaining bosses are listed below; per-stage estimates and
          the reachable-frontier projection appear once the guild logs some boss
          damage this season.
        </div>
        <DataTable
          rows={sequence}
          columns={LOW_CONFIDENCE_COLUMNS}
          rowKey={stageKey}
          rowClassName={(entry) =>
            entry.isCurrentStage
              ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]!'
              : undefined
          }
          className="mt-3"
          tableClassName="text-left"
        />
      </div>
    )
  }

  const rows = buildCumulativeFeasibility(sequence)
  // Index of the last reachable row; -1 if none, null without a budget.
  const reachable =
    tokensSpendable != null ? reachableStageIndex(rows, tokensSpendable) : null
  const reachableEntry =
    reachable != null && reachable >= 0
      ? (rows[reachable]?.entry ?? null)
      : null
  const displayRows: FeasibilityRow[] = rows.map((row, idx) => ({
    ...row,
    outOfReach: reachable != null && idx > reachable
  }))

  return (
    <div className="rounded-lg border border-(--card-border) bg-card/40 p-4">
      <h4 className="text-sm font-semibold text-primary-wh40k">
        Remaining boss feasibility
      </h4>
      <p className="mt-1 text-xs text-secondary-wh40k">
        {hasOfficerTargets
          ? 'Budgeted tokens per remaining stage (officer targets where set, model estimates otherwise), and the running total to reach it.'
          : 'Estimated tokens to clear each remaining stage, and the running total to reach it.'}
        {reachable != null &&
          (reachableEntry ? (
            <>
              {' '}
              With ~{formatNumber(tokensSpendable ?? 0)} spendable tokens by
              season end, projected to reach{' '}
              <span className="font-semibold text-primary-wh40k">
                {getBossDisplayName(reachableEntry.encounters.main.bossName)} (L
                {reachableEntry.loopIndex})
              </span>
              ; greyed rows are beyond the token budget.
            </>
          ) : (
            <>
              {' '}
              ~{formatNumber(tokensSpendable ?? 0)} spendable tokens by season
              end aren&apos;t enough to clear the current stage.
            </>
          ))}
      </p>
      <DataTable
        rows={displayRows}
        columns={buildFeasibilityColumns(hasOfficerTargets)}
        rowKey={({ entry }) => stageKey(entry)}
        rowClassName={({ entry, outOfReach }) =>
          [
            entry.isCurrentStage
              ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]!'
              : '',
            outOfReach ? 'opacity-40' : ''
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className="mt-3"
        tableClassName="text-left"
      />
    </div>
  )
}

export default memo(BossFeasibilityTable)
