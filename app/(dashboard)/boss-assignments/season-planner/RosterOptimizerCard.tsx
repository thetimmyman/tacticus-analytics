'use client'

import { Sparkles } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import {
  deltaClass,
  signedNumber
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type { RosterStrategyOptimizerCandidate } from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

interface RosterOptimizerCardProps {
  optimizer: RosterStrategyOptimizerCandidate[]
  strategyOptimizerRequested: boolean
  guildLabel: (guildCode: string) => string
}

export default function RosterOptimizerCard({
  optimizer,
  strategyOptimizerRequested,
  guildLabel
}: RosterOptimizerCardProps) {
  const optimizerColumns: DataTableColumn<RosterStrategyOptimizerCandidate>[] =
    [
      {
        key: 'candidate',
        header: 'Candidate',
        sortable: false,
        render: (candidate) => (
          <span className="text-[var(--text-primary)]">
            {candidate.candidateDisplayName}
            <span className="ml-1 text-xs text-[var(--text-secondary)]">
              {guildLabel(candidate.candidateGuildCode)}
            </span>
          </span>
        )
      },
      {
        key: 'swapOut',
        header: 'Swap out',
        sortable: false,
        render: (candidate) => candidate.replacedDisplayName
      },
      {
        key: 'clears',
        header: 'Clears',
        sortable: false,
        render: (candidate) => (
          <span className={deltaClass(candidate.delta.bossesDefeated)}>
            {signedNumber(candidate.delta.bossesDefeated)}
          </span>
        )
      },
      {
        key: 'damagePerToken',
        header: 'Damage/token',
        sortable: false,
        render: (candidate) => (
          <span className={deltaClass(candidate.delta.tokenEfficiency)}>
            {signedNumber(candidate.delta.tokenEfficiency)}
          </span>
        )
      },
      {
        key: 'fitDamage',
        header: 'Fit damage',
        sortable: false,
        render: (candidate) => formatNumber(candidate.fitDamage)
      },
      {
        key: 'samples',
        header: 'Samples',
        sortable: false,
        render: (candidate) => formatNumber(candidate.sampleCount)
      }
    ]

  return optimizer.length > 0 ? (
    <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--accent)]" />
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">
          Roster optimizer
        </h4>
      </div>
      <div className="mt-3">
        <DataTable
          rows={optimizer}
          columns={optimizerColumns}
          rowKey={(candidate) =>
            `${candidate.candidatePlayerId}-${candidate.replacedPlayerId}`
          }
          empty={<></>}
        />
      </div>
    </div>
  ) : strategyOptimizerRequested ? (
    <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4 text-sm text-[var(--text-secondary)]">
      No positive roster swaps were found for the selected window.
    </div>
  ) : null
}
