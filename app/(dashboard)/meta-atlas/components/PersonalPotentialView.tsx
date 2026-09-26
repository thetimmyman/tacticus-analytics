'use client'

import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import type { PersonalPotentialViewProps } from './personal-potential-model'
import { PersonalPotentialContent } from './PersonalPotentialContent'

export function PersonalPotentialView({
  data,
  loading,
  heroMappings,
  rosterEntries,
  hasBattleHistory,
  hasRoster,
  strengthOverridesLookup
}: PersonalPotentialViewProps) {
  if (loading) {
    return (
      <div className="py-6 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="py-6 text-center text-sm text-[var(--text-secondary)]">
        No personalized data available yet.
      </div>
    )
  }

  if (data.progression_error) {
    return (
      <div className="py-6 text-center text-sm text-red-400">
        {data.progression_error}
      </div>
    )
  }

  return (
    <PersonalPotentialContent
      data={data}
      heroMappings={heroMappings}
      rosterEntries={rosterEntries}
      hasBattleHistory={hasBattleHistory}
      hasRoster={hasRoster}
      strengthOverridesLookup={strengthOverridesLookup}
    />
  )
}
