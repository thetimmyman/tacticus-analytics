'use client'

import type {
  PlannedAction,
  PlannedSession
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import { compareStrategyMembers } from './planner-format'
import type {
  GeneratedSeasonPlanPayload,
  LoopTimelineRow,
  PerPlayerTotalsRow,
  RosterEntry,
  RosterStrategyMember,
  RosterStrategyPayload,
  SavedPlanRow,
  ScheduleWindow,
  StageTimelineRow
} from './planner-types'

export function buildSeasonConfigByNumber(
  seasonConfigResolutions: Array<{ seasonNumber: number; configId: string }>
): Map<number, string> {
  const map = new Map<number, string>()
  for (const resolution of seasonConfigResolutions) {
    if (
      Number.isFinite(resolution.seasonNumber) &&
      typeof resolution.configId === 'string' &&
      resolution.configId.trim().length > 0
    ) {
      map.set(resolution.seasonNumber, resolution.configId)
    }
  }
  return map
}

export function filterStrategyTargetMembers(
  strategy: RosterStrategyPayload | null
): RosterStrategyMember[] {
  if (!strategy) return []
  return strategy.members
    .filter((member) => member.guildCode === strategy.targetGuildCode)
    .sort(compareStrategyMembers)
}

export function filterStrategyAllIncomingMembers(
  strategy: RosterStrategyPayload | null
): RosterStrategyMember[] {
  if (!strategy) return []
  return strategy.members
    .filter((member) => member.guildCode !== strategy.targetGuildCode)
    .sort(compareStrategyMembers)
}

export function buildGuildPresentationByCode(
  strategy: RosterStrategyPayload | null
): Map<string, { label: string; optionLabel: string; memberCount: number }> {
  const map = new Map<
    string,
    { label: string; optionLabel: string; memberCount: number }
  >()
  if (!strategy) return map

  const counts = new Map<string, number>()
  for (const member of strategy.members) {
    counts.set(member.guildCode, (counts.get(member.guildCode) ?? 0) + 1)
  }

  let unnamedCount = 0
  const guilds = [...strategy.guilds].sort((a, b) => {
    const aName = a.displayName?.trim() || ''
    const bName = b.displayName?.trim() || ''
    return (
      aName.localeCompare(bName, undefined, { sensitivity: 'base' }) ||
      a.guildCode.localeCompare(b.guildCode)
    )
  })

  for (const guild of guilds) {
    const displayName = guild.displayName?.trim()
    const isTarget = guild.guildCode === strategy.targetGuildCode
    const label =
      displayName ||
      (isTarget ? 'Current guild' : `Cluster guild ${++unnamedCount}`)
    const memberCount = counts.get(guild.guildCode) ?? 0
    const memberLabel = `${memberCount} member${memberCount === 1 ? '' : 's'}`
    map.set(guild.guildCode, {
      label,
      optionLabel: isTarget
        ? `${label} · current guild`
        : `${label} · ${memberLabel}`,
      memberCount
    })
  }

  return map
}

export function buildStrategyIncomingGuildOptions(
  strategy: RosterStrategyPayload | null,
  strategyAllIncomingMembers: RosterStrategyMember[],
  guildPresentationByCode: Map<
    string,
    { label: string; optionLabel: string; memberCount: number }
  >
): Array<{ guildCode: string; optionLabel: string }> {
  if (!strategy) return []
  const seen = new Set<string>()
  return strategyAllIncomingMembers
    .filter((member) => {
      if (seen.has(member.guildCode)) return false
      seen.add(member.guildCode)
      return true
    })
    .map((member) => ({
      guildCode: member.guildCode,
      optionLabel:
        guildPresentationByCode.get(member.guildCode)?.optionLabel ??
        'Cluster guild'
    }))
    .sort((a, b) =>
      a.optionLabel.localeCompare(b.optionLabel, undefined, {
        sensitivity: 'base'
      })
    )
}

export function filterStrategyIncomingMembers(
  strategyAllIncomingMembers: RosterStrategyMember[],
  swapIncomingGuildFilter: string
): RosterStrategyMember[] {
  if (swapIncomingGuildFilter === 'all') return strategyAllIncomingMembers
  return strategyAllIncomingMembers.filter(
    (member) => member.guildCode === swapIncomingGuildFilter
  )
}

export function selectDisplayedPlan(
  savedPlanValue: SavedPlanRow['plan'] | undefined,
  plan: GeneratedSeasonPlanPayload | null
): GeneratedSeasonPlanPayload | null {
  const saved = savedPlanValue as GeneratedSeasonPlanPayload | undefined
  if (
    saved &&
    typeof saved === 'object' &&
    typeof saved.season === 'string' &&
    typeof saved.snapshot_at === 'string' &&
    typeof saved.season_end_at === 'string' &&
    saved.plan &&
    Array.isArray(saved.plan.sessions) &&
    saved.plan.metrics
  )
    return saved
  if (plan) return plan
  return null
}

export function buildRosterNameById(
  roster: RosterEntry[]
): Map<string, string> {
  const map = new Map<string, string>()
  roster.forEach((entry) => {
    if (!entry?.player_id) return
    const name =
      typeof entry.display_name === 'string' &&
      entry.display_name.trim().length > 0
        ? entry.display_name
        : null
    map.set(entry.player_id, name ?? 'Unknown player')
  })
  return map
}

export function filterSessionsWindow(
  displayedPlan: GeneratedSeasonPlanPayload | null,
  scheduleWindow: ScheduleWindow,
  sessions: PlannedSession[]
): PlannedSession[] {
  if (!displayedPlan) return []
  if (scheduleWindow === 'all') return sessions

  const snapshotAt = new Date(displayedPlan.snapshot_at).getTime()
  const horizonMs =
    scheduleWindow === '24h'
      ? 24 * 60 * 60 * 1000
      : scheduleWindow === '48h'
        ? 48 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000

  return sessions.filter((session) => {
    const at = new Date(session.at).getTime()
    return (
      Number.isFinite(at) && at >= snapshotAt && at <= snapshotAt + horizonMs
    )
  })
}

export function buildStageTimelineWindow(
  displayedPlan: GeneratedSeasonPlanPayload | null,
  sessions: PlannedSession[],
  rosterNameById: Map<string, string>,
  scheduleWindow: ScheduleWindow
): StageTimelineRow[] {
  if (!displayedPlan) return []

  const snapshotAtMs = new Date(displayedPlan.snapshot_at).getTime()
  const horizonMs =
    scheduleWindow === 'all'
      ? null
      : scheduleWindow === '24h'
        ? 24 * 60 * 60 * 1000
        : scheduleWindow === '48h'
          ? 48 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000

  const withinWindow = (iso: string) => {
    if (scheduleWindow === 'all') return true
    const at = new Date(iso).getTime()
    return (
      Number.isFinite(at) &&
      Number.isFinite(snapshotAtMs) &&
      at >= snapshotAtMs &&
      at <= snapshotAtMs + (horizonMs ?? 0)
    )
  }

  const actions: PlannedAction[] = []
  sessions.forEach((session) => {
    session.actions?.forEach((action) => {
      if (action?.type !== 'token_attack') return
      actions.push(action)
    })
  })

  const timeline: Array<
    StageTimelineRow & { _playerTokens: Map<string, number> }
  > = []
  let current:
    (StageTimelineRow & { _playerTokens: Map<string, number> }) | null = null

  actions.forEach((action) => {
    if (!withinWindow(action.at)) return

    const stageCode = action.stageCode
    const loopIndex = action.loopIndex
    const bossName = action.bossName
    const key = `${loopIndex}:${stageCode}:${bossName}`

    const currentKey = current
      ? `${current.loopIndex}:${current.stageCode}:${current.bossName}`
      : null
    if (!current || currentKey !== key) {
      current = {
        stageCode,
        loopIndex,
        bossName,
        startAt: action.at,
        endAt: action.at,
        tokens: 0,
        players: [],
        expectedDamage: 0,
        appliedDamage: 0,
        overkillDamage: 0,
        _playerTokens: new Map<string, number>()
      }
      timeline.push(current)
    }

    current.endAt = action.at
    current.tokens += 1
    current.expectedDamage += action.expectedDamage ?? 0
    current.appliedDamage += action.appliedDamage ?? 0
    current.overkillDamage += action.overkillDamage ?? 0

    const prev = current._playerTokens.get(action.playerId) ?? 0
    current._playerTokens.set(action.playerId, prev + 1)
  })

  timeline.forEach((row) => {
    const players = Array.from(row._playerTokens.entries())
      .map(([playerId, tokens]) => ({
        playerId,
        displayName: rosterNameById.get(playerId) || 'Unknown player',
        tokens
      }))
      .sort(
        (a, b) =>
          b.tokens - a.tokens || a.displayName.localeCompare(b.displayName)
      )

    row.players = players
  })

  return timeline.map(({ _playerTokens, ...row }) => row)
}

export function buildLoopTimelineWindow(
  stageTimelineWindow: StageTimelineRow[]
): LoopTimelineRow[] {
  const map = new Map<
    number,
    {
      loopIndex: number
      startAt: string
      endAt: string
      stages: number
      tokens: number
      uniquePlayers: number
    }
  >()

  stageTimelineWindow.forEach((row) => {
    const existing = map.get(row.loopIndex)
    const startAt = existing ? existing.startAt : row.startAt
    const endAt = existing ? existing.endAt : row.endAt

    const next = {
      loopIndex: row.loopIndex,
      startAt,
      endAt,
      stages: (existing?.stages ?? 0) + 1,
      tokens: (existing?.tokens ?? 0) + row.tokens,
      uniquePlayers: 0
    }

    map.set(row.loopIndex, next)

    if (row.startAt < startAt) next.startAt = row.startAt
    if (row.endAt > endAt) next.endAt = row.endAt
  })

  const rows = Array.from(map.values()).sort(
    (a, b) => a.loopIndex - b.loopIndex
  )

  rows.forEach((row) => {
    const playerIds = new Set<string>()
    stageTimelineWindow
      .filter((segment) => segment.loopIndex === row.loopIndex)
      .forEach((segment) =>
        segment.players.forEach((p) => playerIds.add(p.playerId))
      )
    row.uniquePlayers = playerIds.size
  })

  return rows
}

export function buildPerPlayerTotals(
  sessions: PlannedSession[],
  rosterNameById: Map<string, string>
): PerPlayerTotalsRow[] {
  const map = new Map<
    string,
    {
      playerId: string
      displayName: string
      sessions: number
      spent: number
      held: number
    }
  >()
  sessions.forEach((session) => {
    const sessionDisplayName =
      typeof session.playerDisplayName === 'string' &&
      session.playerDisplayName.trim().length > 0
        ? session.playerDisplayName
        : null
    const key = session.playerId
    if (!map.has(key)) {
      map.set(key, {
        playerId: key,
        displayName:
          sessionDisplayName || rosterNameById.get(key) || 'Unknown player',
        sessions: 0,
        spent: 0,
        held: 0
      })
    }
    const entry = map.get(key)!
    if (sessionDisplayName && entry.displayName !== sessionDisplayName)
      entry.displayName = sessionDisplayName
    entry.sessions += 1
    entry.spent += session.tokensSpent ?? 0
    entry.held += session.tokensHeld ?? 0
  })

  return Array.from(map.values()).sort((a, b) => b.spent - a.spent)
}

export function buildRawPlanJson(
  showRaw: boolean,
  displayedPlan: GeneratedSeasonPlanPayload | null,
  rosterNameById: Map<string, string>
): string | null {
  if (!showRaw || !displayedPlan) return null
  return JSON.stringify(
    displayedPlan,
    (key, value) => {
      if (
        (key === 'playerId' || key === 'player_id') &&
        typeof value === 'string'
      ) {
        return rosterNameById.get(value) || 'Unknown player'
      }
      return value
    },
    2
  )
}
