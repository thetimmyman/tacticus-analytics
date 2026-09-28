'use client'

import { ClipboardList } from 'lucide-react'
import { useHeroCatalog } from '@/app/lib/catalogs'
import RequirementCard from '../RequirementCard'
import { RequirementDisplayRow } from './RequirementTableRows'
import type { RequirementEntry } from './requirements-shared'

type ReadOnlyRequirementsViewProps = {
  loading: boolean
  error: string | null
  allDisplayRequirements: Array<{
    requirement: RequirementEntry
    scopeLabel: string
    scopeColor: 'amber' | 'blue' | 'gray'
  }>
  heroCatalog: ReturnType<typeof useHeroCatalog>['data']
}

export function ReadOnlyRequirementsView({
  loading,
  error,
  allDisplayRequirements,
  heroCatalog
}: ReadOnlyRequirementsViewProps) {
  return (
    <div className="card-wh40k p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
        <ClipboardList className="h-4 w-4 text-(--accent)" />
        Minimum Viable Team Requirements
      </div>

      {loading && (
        <div className="text-xs text-(--text-tertiary)">
          Loading requirements...
        </div>
      )}
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {!loading && !error && allDisplayRequirements.length === 0 && (
        <div className="text-xs text-(--text-tertiary)">
          No team requirements defined yet.
        </div>
      )}

      {!loading && allDisplayRequirements.length > 0 && (
        <>
          {/* Mobile: Card Layout */}
          <div className="md:hidden space-y-3">
            {allDisplayRequirements.map(
              ({ requirement, scopeLabel, scopeColor }) => (
                <RequirementCard
                  key={requirement.id}
                  requirement={requirement}
                  scopeLabel={scopeLabel}
                  scopeColor={scopeColor}
                />
              )
            )}
          </div>

          {/* Desktop: Table Layout */}
          <div className="hidden md:block overflow-x-auto -mx-4 px-4">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-(--card-border) text-[10px] text-(--text-tertiary)">
                  <th className="py-2 px-2 font-medium">Category</th>
                  <th className="py-2 px-2 font-medium">Meta Team</th>
                  <th className="py-2 px-1 font-medium">Hero 1</th>
                  <th className="py-2 px-1 font-medium">Hero 2</th>
                  <th className="py-2 px-1 font-medium">Hero 3</th>
                  <th className="py-2 px-1 font-medium">Hero 4</th>
                  <th className="py-2 px-1 font-medium">Hero 5</th>
                  <th className="py-2 px-1 font-medium">MOW</th>
                </tr>
              </thead>
              <tbody>
                {allDisplayRequirements.map(
                  ({ requirement, scopeLabel, scopeColor }) => (
                    <RequirementDisplayRow
                      key={requirement.id}
                      requirement={requirement}
                      heroCatalog={heroCatalog}
                      scopeLabel={scopeLabel}
                      scopeColor={scopeColor}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
