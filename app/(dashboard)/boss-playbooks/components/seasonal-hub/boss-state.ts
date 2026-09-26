import { clampThreshold } from '@/app/lib/boss-ops/persistence'
import { primaryRoleId } from '@/app/lib/boss-ops/roles'
import type {
  HeraldBossSummary,
  PingMode,
  SideBehaviour,
  SideState
} from '@/app/lib/boss-ops/encounter-ops-types'
import type {
  SeasonalBossCardData,
  SeasonalEncounterData,
  SeasonalHubReplayLinkMode
} from '../../seasonal-hub-utils'
import type { HubBossState } from './types'
import {
  messageStateFromEncounter,
  roleEntriesFromEncounter,
  syncNarrativeInclude
} from './message-state'

export function bossReady(card: SeasonalBossCardData) {
  return Boolean(
    card.mainEncounter.roleIds.length > 0 &&
    card.mainEncounter.targetToken?.targetTokens &&
    !card.mainEncounter.targetToken.skip
  )
}

export function buildHeraldSummary(
  card: SeasonalBossCardData
): HeraldBossSummary {
  return {
    group_key: card.key,
    boss_type: card.bossType,
    boss_name: card.bossName,
    rarity: card.rarity,
    set: card.setNumber,
    main: {
      boss_id: card.mainEncounter.bossId,
      boss_name: card.mainEncounter.bossName,
      encounter_id: 0
    },
    sides: card.sideEncounters.map((encounter) => ({
      boss_id: encounter.bossId,
      boss_name: encounter.bossName,
      encounter_id: encounter.encounterIndex
    }))
  }
}

export function sideFromEncounter(
  encounter: SeasonalEncounterData | null
): SideState | null {
  if (!encounter) return null
  const roles = roleEntriesFromEncounter(encounter)
  return {
    role: primaryRoleId(roles),
    behaviour: encounter.behaviour,
    threshold: clampThreshold(encounter.thresholdHpPct ?? 60) || 60,
    notes: encounter.notes ?? ''
  }
}

export function deriveInitialPingMode(
  card: SeasonalBossCardData,
  side1: SideState | null,
  side2: SideState | null
): PingMode {
  if (card.seasonOps?.pingMode) return card.seasonOps.pingMode
  if (
    (!side1 || side1.behaviour === 'skip') &&
    (!side2 || side2.behaviour === 'skip')
  ) {
    return 'skip_all'
  }
  return 'per_side'
}

export function buildInitialBossState(
  card: SeasonalBossCardData,
  guildReplayLinkMode: Exclude<SeasonalHubReplayLinkMode, 'inherit'>
): HubBossState {
  const side1 = sideFromEncounter(card.sideEncounters[0] ?? null)
  const side2 = sideFromEncounter(card.sideEncounters[1] ?? null)
  const mainRoles = roleEntriesFromEncounter(card.mainEncounter)
  const side1Roles = card.sideEncounters[0]
    ? roleEntriesFromEncounter(card.sideEncounters[0])
    : []
  const side2Roles = card.sideEncounters[1]
    ? roleEntriesFromEncounter(card.sideEncounters[1])
    : []
  return {
    group_key: card.key,
    expanded: true,
    mainRole: primaryRoleId(mainRoles),
    mainRoles,
    mainNotes: card.mainEncounter.notes ?? '',
    mainMessage: messageStateFromEncounter(
      card,
      card.mainEncounter,
      card.mainEncounter.notes ?? '',
      guildReplayLinkMode
    ),
    pingMode: deriveInitialPingMode(card, side1, side2),
    side1,
    side1Roles,
    side2,
    side2Roles,
    side1Message: card.sideEncounters[0]
      ? messageStateFromEncounter(
          card,
          card.sideEncounters[0],
          side1?.notes ?? '',
          guildReplayLinkMode
        )
      : null,
    side2Message: card.sideEncounters[1]
      ? messageStateFromEncounter(
          card,
          card.sideEncounters[1],
          side2?.notes ?? '',
          guildReplayLinkMode
        )
      : null,
    saveStatus: 'idle',
    dirty: false,
    editVersion: 0
  }
}

/**
 * Must never mutate notes: the dispatcher merges prime notes at post time, so rewriting them
 * loses distinct Prime 1/2 notes. `skip_all` rewrites behaviour; leaving it restores 'kill'.
 */
export function applyPingModeChange(
  prev: HubBossState,
  pingMode: PingMode
): HubBossState {
  const side1 =
    pingMode === 'skip_all' && prev.side1
      ? { ...prev.side1, behaviour: 'skip' as SideBehaviour }
      : prev.pingMode === 'skip_all' && prev.side1?.behaviour === 'skip'
        ? { ...prev.side1, behaviour: 'kill' as SideBehaviour, threshold: 60 }
        : prev.side1
  const side2 =
    pingMode === 'skip_all' && prev.side2
      ? { ...prev.side2, behaviour: 'skip' as SideBehaviour }
      : prev.pingMode === 'skip_all' && prev.side2?.behaviour === 'skip'
        ? { ...prev.side2, behaviour: 'kill' as SideBehaviour, threshold: 60 }
        : prev.side2

  return {
    ...prev,
    side1,
    side2,
    side1Message:
      side1 && prev.side1Message
        ? syncNarrativeInclude(prev.side1Message, side1.notes)
        : prev.side1Message,
    side2Message:
      side2 && prev.side2Message
        ? syncNarrativeInclude(prev.side2Message, side2.notes)
        : prev.side2Message,
    pingMode,
    dirty: true,
    saveStatus: prev.saveStatus === 'error' ? 'idle' : prev.saveStatus,
    editVersion: prev.editVersion + 1
  }
}
