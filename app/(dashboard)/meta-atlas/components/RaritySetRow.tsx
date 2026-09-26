'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import type { BossData } from '../types'
import type { HeroMapping } from '../utils/hero-mapping'
import { BossCardDualView } from './BossCardDualView'
import { EncounterColumn } from './EncounterColumn'
import { PersonalPotentialView } from './PersonalPotentialView'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type { StrengthOverridesLookup } from '../hooks/usePlaybookStrengthOverridesBatch'

type HeroMappings = Map<string, HeroMapping>

export function RaritySetRow({
  raritySet,
  bossName,
  bossType,
  main,
  prime1,
  prime2,
  heroMappings,
  rosterEntries,
  viewMode,
  onViewModeChange,
  canPersonalize,
  showViewToggle = true,
  personalizationLoading,
  anchorId,
  hasBattleHistory,
  hasRoster,
  strengthOverridesLookup
}: {
  raritySet: string
  bossName: string
  bossType: string
  main: BossData | null
  prime1: BossData | null
  prime2: BossData | null
  heroMappings: HeroMappings
  rosterEntries: RosterInputEntry[]
  viewMode: 'global' | 'personal'
  onViewModeChange: (mode: 'global' | 'personal') => void
  canPersonalize: boolean
  showViewToggle?: boolean
  personalizationLoading: boolean
  anchorId: string
  hasBattleHistory: boolean
  hasRoster: boolean
  strengthOverridesLookup?: StrengthOverridesLookup
}) {
  const getRaritySetBadgeStyle = (rs: string): string => {
    const isMythic = rs.startsWith('M')
    return isMythic
      ? 'bg-orange-500/30 text-orange-300 border-orange-500/50'
      : 'bg-cyan-500/30 text-cyan-300 border-cyan-500/50'
  }

  const headerData = main || prime1 || prime2
  const topTeam = headerData?.recommendations?.[0]
  const summary = topTeam
    ? `Best: ${topTeam.meta_team || 'Custom'} • P90: ${formatNumber(Math.round(topTeam.damage_p90))} • ${formatNumber(topTeam.attack_count)} atk`
    : null

  const globalContent = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <EncounterColumn
        bossData={main}
        encounterLabel="Main Boss"
        heroMappings={heroMappings}
      />
      <EncounterColumn
        bossData={prime1}
        encounterLabel="Prime 1"
        heroMappings={heroMappings}
      />
      <EncounterColumn
        bossData={prime2}
        encounterLabel="Prime 2"
        heroMappings={heroMappings}
      />
    </div>
  )

  const personalData = main || prime1 || prime2
  const personalContent = (
    <PersonalPotentialView
      data={personalData}
      loading={personalizationLoading}
      heroMappings={heroMappings}
      rosterEntries={rosterEntries}
      hasBattleHistory={hasBattleHistory}
      hasRoster={hasRoster}
      strengthOverridesLookup={strengthOverridesLookup}
    />
  )

  return (
    <BossCardDualView
      anchorId={anchorId}
      bossName={bossName}
      bossType={bossType}
      bossLookupName={headerData?.boss_lookup_name || bossType}
      raritySet={raritySet}
      summary={summary}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      canPersonalize={canPersonalize}
      showViewToggle={showViewToggle}
      badgeClassName={getRaritySetBadgeStyle(raritySet)}
      globalContent={globalContent}
      personalContent={personalContent}
    />
  )
}
