import {
  type ProgressionConfig,
  nextStage as nextStageFromConfig
} from '@/app/lib/boss-assignments/progression-config-shared'
import {
  advanceStamina,
  spendStamina,
  type StaminaSettings,
  type StaminaState
} from '@/app/lib/boss-assignments/season-planner/stamina-simulator'
import { SEASON_MAX_SPENDABLE_TOKENS } from '@/app/lib/calculations/token-calculation'

export type EncounterId = 0 | 1 | 2

export interface StageTemplate {
  stageCode: string
  encounters: Record<EncounterId, { bossName: string; maxHp: number }>
}

export interface EncounterState {
  encounterId: EncounterId
  stageCode: string
  loopIndex: number
  bossName: string
  maxHp: number
  remainingHp: number
}

export interface RaidState {
  stageCode: string
  loopIndex: number
  encounters: Record<EncounterId, EncounterState>
}

export interface PlannerPlayer {
  playerId: string
  displayName: string
  sessionsAt: number[]
  tokenState: StaminaState
  seasonSpent?: number
}

export interface PlannerOptions {
  snapshotAt: number
  seasonEndAt: number
  stamina: StaminaSettings
  optionalSpendMinHpMultiplier: number
  seasonMaxTokens?: number
}

export interface PlannedAction {
  type: 'token_attack'
  at: string
  playerId: string
  stageCode: string
  loopIndex: number
  encounterId: EncounterId
  bossName: string
  expectedDamage: number
  appliedDamage: number
  overkillDamage: number
}

export interface PlannedSession {
  at: string
  playerId: string
  playerDisplayName?: string
  tokensAvailable: number
  tokensSpent: number
  tokensHeld: number
  actions: PlannedAction[]
}

export interface PlannerMetrics {
  tokensSpent: number
  overkillDamage: number
  bossesDefeated: number
  loopAdvances: number
  wastedTokens: number
  wastedTicks: number
}

export interface PlannerResult {
  sessions: PlannedSession[]
  finalRaidState: RaidState
  metrics: PlannerMetrics
  warnings: string[]
}

export type DamageEstimator = (args: {
  playerId: string
  encounter: EncounterState
}) => number

function nextStageCode(
  stageCode: string,
  loopIndex: number,
  config: ProgressionConfig
): { stageCode: string; wrapsLoop: boolean; loopIndex: number } {
  return nextStageFromConfig(config, stageCode, loopIndex)
}

function cloneRaidState(state: RaidState): RaidState {
  return {
    stageCode: state.stageCode,
    loopIndex: state.loopIndex,
    encounters: {
      0: { ...state.encounters[0] },
      1: { ...state.encounters[1] },
      2: { ...state.encounters[2] }
    }
  }
}

function buildStageState(
  template: StageTemplate,
  loopIndex: number
): RaidState {
  const encounters: Record<EncounterId, EncounterState> = {
    0: {
      encounterId: 0,
      stageCode: template.stageCode,
      loopIndex,
      bossName: template.encounters[0].bossName,
      maxHp: template.encounters[0].maxHp,
      remainingHp: template.encounters[0].maxHp
    },
    1: {
      encounterId: 1,
      stageCode: template.stageCode,
      loopIndex,
      bossName: template.encounters[1].bossName,
      maxHp: template.encounters[1].maxHp,
      remainingHp: template.encounters[1].maxHp
    },
    2: {
      encounterId: 2,
      stageCode: template.stageCode,
      loopIndex,
      bossName: template.encounters[2].bossName,
      maxHp: template.encounters[2].maxHp,
      remainingHp: template.encounters[2].maxHp
    }
  }

  return {
    stageCode: template.stageCode,
    loopIndex,
    encounters
  }
}

function advanceRaidState(
  state: RaidState,
  templatesByStageCode: Map<string, StageTemplate>,
  warnings: string[],
  config: ProgressionConfig
): { state: RaidState; loopAdvanced: boolean } | null {
  const next = nextStageCode(state.stageCode, state.loopIndex, config)
  const nextLoopIndex = next.wrapsLoop ? state.loopIndex + 1 : state.loopIndex
  const template = templatesByStageCode.get(next.stageCode)
  if (!template) {
    warnings.push(
      `Missing stage template for ${next.stageCode}; keeping current stage`
    )
    return null
  }

  return {
    state: buildStageState(template, nextLoopIndex),
    loopAdvanced: next.wrapsLoop
  }
}

export function computeRequiredSpend(args: {
  state: StaminaState
  settings: StaminaSettings
  at: number
  nextAt: number
}): { required: number; unavoidableWaste: boolean } {
  const available = Math.max(0, Math.trunc(args.state.available))
  if (available <= 0) return { required: 0, unavoidableWaste: false }

  for (let spend = 0; spend <= available; spend += 1) {
    const spent = spendStamina({
      state: args.state,
      settings: args.settings,
      amount: spend,
      at: args.at
    })

    const advanced = advanceStamina({
      state: spent.state,
      settings: args.settings,
      from: args.at,
      to: args.nextAt
    })

    if (advanced.metrics.wastedTokens === 0) {
      return { required: spend, unavoidableWaste: false }
    }
  }

  return { required: available, unavoidableWaste: true }
}

export function planSeason(args: {
  players: PlannerPlayer[]
  initialRaidState: RaidState
  stageTemplates: StageTemplate[]
  options: PlannerOptions
  estimateDamage: DamageEstimator
  progressionConfig: ProgressionConfig
}): PlannerResult {
  const warnings: string[] = []
  const raidState = cloneRaidState(args.initialRaidState)

  const templatesByStageCode = new Map<string, StageTemplate>(
    args.stageTemplates.map((template) => [template.stageCode, template])
  )

  const seasonMaxTokens =
    args.options.seasonMaxTokens ?? SEASON_MAX_SPENDABLE_TOKENS

  const playerById = new Map(args.players.map((p) => [p.playerId, p]))

  const playerStates = new Map<
    string,
    {
      token: StaminaState
      lastAt: number
      wastedTokens: number
      wastedTicks: number
      seasonSpent: number
    }
  >()

  args.players.forEach((player) => {
    playerStates.set(player.playerId, {
      token: player.tokenState,
      lastAt: args.options.snapshotAt,
      wastedTokens: 0,
      wastedTicks: 0,
      seasonSpent:
        typeof player.seasonSpent === 'number' &&
        Number.isFinite(player.seasonSpent)
          ? Math.max(0, Math.trunc(player.seasonSpent))
          : 0
    })
  })

  type Event = { at: number; playerId: string; sessionIndex: number }
  const events: Event[] = []

  args.players.forEach((player) => {
    const sessions = [...player.sessionsAt]
      .map((ms) => Math.trunc(ms))
      .filter(
        (ms) =>
          Number.isFinite(ms) &&
          ms >= args.options.snapshotAt &&
          ms < args.options.seasonEndAt
      )
      .sort((a, b) => a - b)

    sessions.forEach((at, idx) => {
      events.push({ at, playerId: player.playerId, sessionIndex: idx })
    })
  })

  events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    return a.playerId.localeCompare(b.playerId)
  })

  const plannedSessions: PlannedSession[] = []

  let tokensSpentTotal = 0
  let overkillDamageTotal = 0
  let bossesDefeated = 0
  let loopAdvances = 0
  let wastedTokensTotal = 0
  let wastedTicksTotal = 0

  const sessionsByPlayer = new Map<string, number[]>()
  args.players.forEach((player) => {
    sessionsByPlayer.set(
      player.playerId,
      [...player.sessionsAt]
        .map((ms) => Math.trunc(ms))
        .filter(
          (ms) =>
            Number.isFinite(ms) &&
            ms >= args.options.snapshotAt &&
            ms < args.options.seasonEndAt
        )
        .sort((a, b) => a - b)
    )
  })

  // maxHp <= 0 means no prime or no HP data: never gets tokens or gates progression.
  const isEncounterActive = (encounter: EncounterState): boolean =>
    encounter.maxHp > 0 && encounter.remainingHp > 0

  // Combined main+prime demand, matching BossFeasibilityTable.
  const stageFullyCleared = (): boolean =>
    !isEncounterActive(raidState.encounters[0]) &&
    !isEncounterActive(raidState.encounters[1]) &&
    !isEncounterActive(raidState.encounters[2])

  const ensureActiveStage = () => {
    // Only trips on degenerate all-zero-HP templates.
    let guard = templatesByStageCode.size + 1
    while (stageFullyCleared()) {
      if (guard-- <= 0) {
        warnings.push(
          'Stage advance guard tripped; stopping to avoid a non-progressing loop'
        )
        break
      }
      const advanced = advanceRaidState(
        raidState,
        templatesByStageCode,
        warnings,
        args.progressionConfig
      )
      if (!advanced) {
        break
      }
      loopAdvances += advanced.loopAdvanced ? 1 : 0
      raidState.stageCode = advanced.state.stageCode
      raidState.loopIndex = advanced.state.loopIndex
      raidState.encounters = advanced.state.encounters
      bossesDefeated += 1
    }
  }

  // Never burn a token into a zero-signal target while another has positive signal.
  const pickRequiredTarget = (playerId: string): EncounterState | null => {
    for (const id of [0, 1, 2] as EncounterId[]) {
      const encounter = raidState.encounters[id]
      if (!isEncounterActive(encounter)) continue
      const expectedDamage = Math.max(
        0,
        args.estimateDamage({ playerId, encounter })
      )
      if (expectedDamage > 0) return encounter
    }
    return null
  }

  const pickOptionalTarget = (
    playerId: string,
    mult: number
  ): EncounterState | null => {
    for (const id of [0, 1, 2] as EncounterId[]) {
      const encounter = raidState.encounters[id]
      if (!isEncounterActive(encounter)) continue
      const expectedDamage = Math.max(
        0,
        args.estimateDamage({ playerId, encounter })
      )
      if (expectedDamage <= 0) continue
      if (encounter.remainingHp >= expectedDamage * mult) return encounter
    }
    return null
  }

  ensureActiveStage()

  for (const event of events) {
    const player = playerById.get(event.playerId)
    if (!player) continue

    const playerState = playerStates.get(event.playerId)
    if (!playerState) continue

    const advance = advanceStamina({
      state: playerState.token,
      settings: args.options.stamina,
      from: playerState.lastAt,
      to: event.at
    })

    playerState.token = advance.state
    playerState.lastAt = event.at
    playerState.wastedTokens += advance.metrics.wastedTokens
    playerState.wastedTicks += advance.metrics.wastedTicks

    wastedTokensTotal += advance.metrics.wastedTokens
    wastedTicksTotal += advance.metrics.wastedTicks

    const sessions = sessionsByPlayer.get(event.playerId) ?? []
    const nextAt = sessions[event.sessionIndex + 1] ?? args.options.seasonEndAt

    const available = Math.max(0, Math.trunc(playerState.token.available))

    const requiredResult = computeRequiredSpend({
      state: playerState.token,
      settings: args.options.stamina,
      at: event.at,
      nextAt
    })

    if (requiredResult.unavoidableWaste) {
      warnings.push(
        `Unavoidable token waste for ${player.displayName} between sessions at ${new Date(event.at).toISOString()}`
      )
    }

    const requiredSpend = Math.min(available, requiredResult.required)
    let tokensSpent = 0
    let tokensHeld = available - requiredSpend
    const actions: PlannedAction[] = []

    const spendOneOn = (encounter: EncounterState): boolean => {
      if (playerState.seasonSpent >= seasonMaxTokens) return false

      const expectedDamage = Math.max(
        0,
        args.estimateDamage({ playerId: event.playerId, encounter })
      )
      const appliedDamage = Math.min(encounter.remainingHp, expectedDamage)
      const overkillDamage = Math.max(0, expectedDamage - appliedDamage)

      encounter.remainingHp = Math.max(0, encounter.remainingHp - appliedDamage)

      actions.push({
        type: 'token_attack',
        at: new Date(event.at).toISOString(),
        playerId: event.playerId,
        stageCode: encounter.stageCode,
        loopIndex: encounter.loopIndex,
        encounterId: encounter.encounterId,
        bossName: encounter.bossName,
        expectedDamage,
        appliedDamage,
        overkillDamage
      })

      tokensSpent += 1
      tokensSpentTotal += 1
      playerState.seasonSpent += 1
      overkillDamageTotal += overkillDamage

      const spendResult = spendStamina({
        state: playerState.token,
        settings: args.options.stamina,
        amount: 1,
        at: event.at
      })
      playerState.token = spendResult.state

      return true
    }

    // Before the season-cap check, so a stage cleared exactly at the cap still advances.
    for (let i = 0; i < requiredSpend; i += 1) {
      if (playerState.token.available <= 0) break
      ensureActiveStage()
      const target = pickRequiredTarget(event.playerId)
      if (!target) {
        warnings.push(
          `No positive-damage target for ${player.displayName} at ${new Date(event.at).toISOString()}; holding required spend`
        )
        break
      }
      if (!spendOneOn(target)) break
    }

    const optionalMultiplier = Math.max(
      0,
      args.options.optionalSpendMinHpMultiplier
    )
    while (playerState.token.available > 0 && tokensHeld > 0) {
      ensureActiveStage()
      const target = pickOptionalTarget(event.playerId, optionalMultiplier)
      if (!target) break
      if (!spendOneOn(target)) break
      tokensHeld -= 1
    }

    ensureActiveStage()

    plannedSessions.push({
      at: new Date(event.at).toISOString(),
      playerId: event.playerId,
      playerDisplayName: player.displayName,
      tokensAvailable: available,
      tokensSpent,
      tokensHeld: available - tokensSpent,
      actions
    })
  }

  for (const [playerId, state] of playerStates) {
    const advanced = advanceStamina({
      state: state.token,
      settings: args.options.stamina,
      from: state.lastAt,
      to: args.options.seasonEndAt
    })
    wastedTokensTotal += advanced.metrics.wastedTokens
    wastedTicksTotal += advanced.metrics.wastedTicks
    playerStates.set(playerId, {
      ...state,
      token: advanced.state,
      lastAt: args.options.seasonEndAt,
      wastedTokens: state.wastedTokens + advanced.metrics.wastedTokens,
      wastedTicks: state.wastedTicks + advanced.metrics.wastedTicks
    })
  }

  return {
    sessions: plannedSessions,
    finalRaidState: raidState,
    metrics: {
      tokensSpent: tokensSpentTotal,
      overkillDamage: overkillDamageTotal,
      bossesDefeated,
      loopAdvances,
      wastedTokens: wastedTokensTotal,
      wastedTicks: wastedTicksTotal
    },
    warnings
  }
}
