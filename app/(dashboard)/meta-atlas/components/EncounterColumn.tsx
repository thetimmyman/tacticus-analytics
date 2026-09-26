'use client'

import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type { BossData } from '../types'
import { TeamCard } from './TeamCard'
import type { HeroMapping } from '../utils/hero-mapping'

type HeroMappings = Map<string, HeroMapping>

export function EncounterColumn({
  bossData,
  encounterLabel,
  heroMappings
}: {
  bossData: BossData | null
  encounterLabel: string
  heroMappings: HeroMappings
}) {
  const displayTeams = bossData?.recommendations.slice(0, 3) || []

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide shrink-0">
          {encounterLabel}
        </span>
        {bossData && (
          <>
            <BossPortrait
              bossName={bossData.boss_name}
              lookupName={bossData.boss_lookup_name}
              size="small"
              variant="icon"
            />
            <span className="text-xs font-medium text-white truncate">
              {getBossDisplayName(bossData.boss_name)}
            </span>
          </>
        )}
      </div>
      {!bossData || bossData.recommendations.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-card/50 rounded-lg border border-dashed border-[var(--card-border)] p-4">
          <span className="text-xs text-[var(--text-secondary)]">No data</span>
        </div>
      ) : (
        <div className="flex-1 space-y-2">
          {displayTeams.map((rec, i) => (
            <TeamCard
              key={rec.team_hash}
              rec={rec}
              rank={i + 1}
              heroMappings={heroMappings}
            />
          ))}
          {bossData.recommendations.length > displayTeams.length && (
            <div className="text-center">
              <span className="text-xs text-[var(--text-secondary)]">
                +{bossData.recommendations.length - displayTeams.length} more
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
