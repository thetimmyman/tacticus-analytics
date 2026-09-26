'use client'

import { Hammer } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import type { RosterStrategyInvestment } from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

interface InvestmentPrioritiesCardProps {
  investments: RosterStrategyInvestment[]
  investmentRows: RosterStrategyInvestment[]
  labelFor: (displayName: string | null | undefined) => string
}

export default function InvestmentPrioritiesCard({
  investments,
  investmentRows,
  labelFor
}: InvestmentPrioritiesCardProps) {
  const investmentColumns: DataTableColumn<RosterStrategyInvestment>[] = [
    {
      key: 'member',
      header: 'Member',
      sortable: false,
      render: (item) => (
        <span className="text-[var(--text-primary)]">
          {labelFor(item.displayName)}
        </span>
      )
    },
    {
      key: 'hero',
      header: 'Hero',
      sortable: false,
      render: (item) => item.heroName
    },
    {
      key: 'state',
      header: 'State',
      sortable: false,
      render: (item) => item.state
    },
    {
      key: 'bosses',
      header: 'Bosses',
      sortable: false,
      render: (item) => item.bossNames.join(', ') || '-'
    },
    {
      key: 'nextInvestment',
      header: 'Next investment',
      sortable: false,
      render: (item) => item.recommendation
    }
  ]

  return investments.length > 0 ? (
    <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <Hammer className="h-4 w-4 text-[var(--accent)]" />
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">
          Investment priorities
        </h4>
      </div>
      <div className="mt-3">
        <DataTable
          rows={investmentRows}
          columns={investmentColumns}
          rowKey={(item) =>
            `${item.playerId}-${item.heroName}-${item.recommendation}`
          }
          empty={<></>}
        />
      </div>
    </div>
  ) : (
    <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4 text-sm text-[var(--text-secondary)]">
      No urgent owned-hero investment priorities were found for the selected
      window.
    </div>
  )
}
