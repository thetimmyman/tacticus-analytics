import { Errors } from '@/app/lib/errors/AppError'
import { SEASON_MAX_SPENDABLE_TOKENS } from '@/app/lib/calculations/token-calculation'
import { MAX_GUILD_MEMBERS } from '@/app/lib/season-forecast/season-outlook-reduce'
import type { SeasonBoss } from '@/app/lib/loki/season-configs'
import { deriveStageCodeFromSetAndRarity } from './season-planner/snapshot-logic'
import type {
  SavedAssignmentIntent,
  SavedBossChoice,
  ReplacementSummary,
  ClearSummary
} from './saved-assignments-types'

export const SAVED_ASSIGNMENTS_BODY_BYTES = 128 * 1024

/** JSON.parse validates syntax; this bounded lexical pass also refuses duplicate
 * object keys, including equivalent escaped spellings, before any mutation. */
export function parseReplacementJson(text: string): unknown {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw Errors.validation('Invalid replacement JSON')
  }
  const stack: { keys: Set<string> | null; key: boolean }[] = []
  for (const match of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/gu)) {
    const token = match[0]
    if (token === '{' || token === '[') {
      stack.push({ keys: token === '{' ? new Set() : null, key: token === '{' })
      if (stack.length > 8)
        throw Errors.validation('Replacement JSON is too deeply nested')
    } else if (token === '}' || token === ']') {
      stack.pop()
    } else {
      const current = stack.at(-1)
      if (token === ',') {
        if (current?.keys) current.key = true
      } else if (token === ':') {
        if (current) current.key = false
      } else if (current?.keys && current.key) {
        const key = JSON.parse(token) as string
        if (current.keys.has(key))
          throw Errors.validation('Duplicate replacement JSON field')
        current.keys.add(key)
        current.key = false
      }
    }
  }
  return value
}

export type ReplacementAssignment = {
  player_id: string
  token_allocations: Record<string, number>
}
export type ReplacementBoss = {
  level: string
  boss_name: string
  sub_bosses: {
    sub1: string
    sub2: string
    sub1_skip: boolean
    sub2_skip: boolean
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  )
    throw Errors.validation('Invalid saved assignment fields')
  return value
}

export function parseReplacement(value: unknown, captured: SeasonBoss[]) {
  const body = exact(value, ['asOf', 'bosses', 'assignments'])
  if (
    typeof body.asOf !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.asOf)
  )
    throw Errors.validation('An explicit UTC asOf is required')
  const ms = Date.parse(body.asOf)
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString() !==
      (body.asOf.length === 20 ? body.asOf.replace('Z', '.000Z') : body.asOf)
  )
    throw Errors.validation('Invalid asOf')
  if (
    !Array.isArray(body.bosses) ||
    body.bosses.length > 10 ||
    !Array.isArray(body.assignments) ||
    body.assignments.length > MAX_GUILD_MEMBERS
  )
    throw Errors.validation('Saved assignment limits exceeded')

  const encounters = new Map<string, SeasonBoss>()
  for (const boss of captured) {
    const level = deriveStageCodeFromSetAndRarity(boss.set, boss.rarity)
    if (level && /^[ML][1-5]$/.test(level))
      encounters.set(`${level}:${boss.encounter_id}`, boss)
  }
  const levels = new Set<string>()
  const bosses: ReplacementBoss[] = body.bosses.map((raw) => {
    const choice = exact(raw, ['level', 'boss_name', 'sub_bosses'])
    if (
      typeof choice.level !== 'string' ||
      !/^[ML][1-5]$/.test(choice.level) ||
      levels.has(choice.level)
    )
      throw Errors.validation('Invalid or duplicate boss level')
    levels.add(choice.level)
    if (choice.boss_name !== encounters.get(`${choice.level}:0`)?.boss_name)
      throw Errors.unprocessable(
        'Boss choice does not match captured configuration'
      )
    const sub = exact(choice.sub_bosses, [
      'sub1',
      'sub2',
      'sub1_skip',
      'sub2_skip'
    ])
    for (const encounter of [1, 2] as const) {
      const name = sub[`sub${encounter}`]
      if (
        typeof name !== 'string' ||
        (name !== '' &&
          name !== encounters.get(`${choice.level}:${encounter}`)?.boss_name) ||
        typeof sub[`sub${encounter}_skip`] !== 'boolean'
      )
        throw Errors.validation('Invalid captured prime choice')
    }
    return {
      level: choice.level,
      boss_name: choice.boss_name as string,
      sub_bosses: {
        sub1: sub.sub1 as string,
        sub2: sub.sub2 as string,
        sub1_skip: sub.sub1_skip as boolean,
        sub2_skip: sub.sub2_skip as boolean
      }
    }
  })
  const choices = new Map(bosses.map((boss) => [boss.level, boss]))
  const ids = new Set<string>()
  const assignments: ReplacementAssignment[] = body.assignments.map((raw) => {
    const assignment = exact(raw, ['player_id', 'token_allocations'])
    if (
      typeof assignment.player_id !== 'string' ||
      !assignment.player_id ||
      assignment.player_id !== assignment.player_id.trim() ||
      assignment.player_id.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(assignment.player_id) ||
      ids.has(assignment.player_id)
    )
      throw Errors.validation('Invalid or duplicate assignment player')
    ids.add(assignment.player_id)
    if (
      !record(assignment.token_allocations) ||
      Object.keys(assignment.token_allocations).length > 30
    )
      throw Errors.validation('Invalid token allocations')
    const entries = Object.entries(assignment.token_allocations).map(
      ([key, value]) => {
        const match = /^([ML][1-5])(?:_Sub([12]))?$/.exec(key)
        const choice = match?.[1] ? choices.get(match[1]) : undefined
        const prime = match?.[2]
        if (
          !choice ||
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          (prime === '1' &&
            (!choice.sub_bosses.sub1 || choice.sub_bosses.sub1_skip)) ||
          (prime === '2' &&
            (!choice.sub_bosses.sub2 || choice.sub_bosses.sub2_skip))
        )
          throw Errors.validation('Invalid captured token allocation')
        return [key, value] as const
      }
    )
    return {
      player_id: assignment.player_id,
      token_allocations: Object.fromEntries(entries)
    }
  })
  return { asOf: new Date(ms).toISOString(), asOfMs: ms, bosses, assignments }
}

function unavailable(): never {
  throw Errors.external('Saved assignment state unavailable', 503)
}

function nullableText(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= 1024 &&
      !/[\u0000-\u001f\u007f]/u.test(value))
  )
}

function timestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= 64 &&
      Number.isFinite(Date.parse(value)))
  )
}

export function savedState(
  assignments: unknown,
  bosses: unknown
): {
  assignments: SavedAssignmentIntent[]
  bosses: SavedBossChoice[]
} {
  if (
    !Array.isArray(assignments) ||
    assignments.length > MAX_GUILD_MEMBERS ||
    !Array.isArray(bosses) ||
    bosses.length > 10
  )
    unavailable()
  const ids = new Set<string>()
  const levels = new Set<string>()
  return {
    assignments: assignments.map((row) => {
      if (
        !record(row) ||
        typeof row.player_id !== 'string' ||
        !row.player_id ||
        row.player_id.length > 256 ||
        row.player_id !== row.player_id.trim() ||
        /[\u0000-\u001f\u007f]/u.test(row.player_id) ||
        ids.has(row.player_id) ||
        typeof row.display_name !== 'string' ||
        !nullableText(row.display_name) ||
        !nullableText(row.primary_boss) ||
        !nullableText(row.secondary_boss) ||
        !(
          row.uses_flexible_tokens === null ||
          typeof row.uses_flexible_tokens === 'boolean'
        ) ||
        !(
          row.total_tokens_allocated === null ||
          (typeof row.total_tokens_allocated === 'number' &&
            Number.isSafeInteger(row.total_tokens_allocated) &&
            row.total_tokens_allocated >= 0 &&
            row.total_tokens_allocated <= 2147483647)
        ) ||
        !timestamp(row.assigned_at) ||
        !timestamp(row.updated_at)
      )
        unavailable()
      ids.add(row.player_id)
      let allocations: Record<string, number> | null = null
      if (row.token_allocations !== null) {
        if (
          !record(row.token_allocations) ||
          Object.keys(row.token_allocations).length > 30
        )
          unavailable()
        allocations = Object.fromEntries(
          Object.entries(row.token_allocations).map(([key, value]) => {
            if (
              !/^[ML][1-5](?:_Sub[12])?$/.test(key) ||
              typeof value !== 'number' ||
              !Number.isSafeInteger(value) ||
              value < 0 ||
              value > 2147483647
            )
              unavailable()
            return [key, value]
          })
        )
      }
      return {
        player_id: row.player_id,
        display_name: row.display_name,
        primary_boss: row.primary_boss,
        secondary_boss: row.secondary_boss,
        token_allocations: allocations,
        uses_flexible_tokens: row.uses_flexible_tokens,
        total_tokens_allocated: row.total_tokens_allocated,
        assigned_at: row.assigned_at,
        updated_at: row.updated_at
      }
    }),
    bosses: bosses.map((row) => {
      if (
        !record(row) ||
        typeof row.level !== 'string' ||
        !/^[ML][1-5]$/.test(row.level) ||
        levels.has(row.level) ||
        typeof row.boss_name !== 'string' ||
        !row.boss_name ||
        !nullableText(row.boss_name) ||
        !timestamp(row.selected_at) ||
        !(row.sub_bosses === null || record(row.sub_bosses))
      )
        unavailable()
      levels.add(row.level)
      const sub = row.sub_bosses
      if (
        sub &&
        !Object.entries(sub).every(
          ([key, value]) =>
            (['sub1', 'sub2'].includes(key) && nullableText(value)) ||
            (['sub1_skip', 'sub2_skip'].includes(key) &&
              typeof value === 'boolean')
        )
      )
        unavailable()
      return {
        level: row.level,
        boss_name: row.boss_name,
        sub_bosses: sub,
        selected_at: row.selected_at
      }
    })
  }
}

/** Decode only the caller-bound joint snapshot. Never recover a missing RPC
 * through separate table reads that could observe different commits. */
export function savedStateFromRpc(value: unknown) {
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'assignments') ||
    !Object.hasOwn(value, 'bosses')
  )
    unavailable()
  return savedState(value.assignments, value.bosses)
}

export function replacementSummary(value: unknown): ReplacementSummary {
  if (
    !record(value) ||
    Object.keys(value).length !== 3 ||
    !['assignedCount', 'totalPlayers', 'totalTokens'].every(
      (key) =>
        typeof value[key] === 'number' &&
        Number.isSafeInteger(value[key]) &&
        value[key] >= 0
    )
  )
    unavailable()
  const { assignedCount, totalPlayers, totalTokens } = value as Record<
    string,
    number
  >
  if (
    assignedCount! > totalPlayers! ||
    totalPlayers! > MAX_GUILD_MEMBERS ||
    totalTokens! > MAX_GUILD_MEMBERS * SEASON_MAX_SPENDABLE_TOKENS
  )
    unavailable()
  return {
    assignedCount: assignedCount!,
    totalPlayers: totalPlayers!,
    totalTokens: totalTokens!
  }
}

export function clearSummary(value: unknown): ClearSummary {
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    !['assignmentsDeleted', 'bossesDeleted'].every(
      (key) =>
        typeof value[key] === 'number' &&
        Number.isSafeInteger(value[key]) &&
        value[key] >= 0
    )
  )
    unavailable()
  const { assignmentsDeleted, bossesDeleted } = value as Record<string, number>
  if (assignmentsDeleted! > MAX_GUILD_MEMBERS || bossesDeleted! > 10)
    unavailable()
  return {
    assignmentsDeleted: assignmentsDeleted!,
    bossesDeleted: bossesDeleted!
  }
}
