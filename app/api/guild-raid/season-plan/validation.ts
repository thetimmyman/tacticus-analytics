import { z } from 'zod'
import { Errors } from '@/app/lib/errors/AppError'

const date = z.string().datetime({ offset: true })
const text = z.string().min(1).max(128)
const count = z.number().finite().nonnegative()
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const encounter = z
  .object({
    encounterId: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    stageCode: text,
    loopIndex: count.int(),
    bossName: text,
    maxHp: count,
    remainingHp: count
  })
  .passthrough()
const action = z
  .object({
    type: z.literal('token_attack'),
    at: date,
    playerId: text,
    stageCode: text,
    loopIndex: count.int(),
    encounterId: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    bossName: text,
    expectedDamage: count,
    appliedDamage: count,
    overkillDamage: count
  })
  .passthrough()
const generated = z
  .object({
    season: z.string().regex(/^[1-9]\d{0,5}$/),
    season_id: identity,
    season_start_at: date,
    season_end_at: date,
    snapshot_at: date,
    time_zone: text,
    lookback_days: z.number().int().min(1).max(180),
    sessions_per_day: z.number().int().min(1).max(3),
    snapshot: z
      .object({
        guildCode: text,
        season: text,
        seasonId: identity,
        snapshotAt: date
      })
      .passthrough(),
    plan: z
      .object({
        sessions: z
          .array(
            z
              .object({
                at: date,
                playerId: text,
                tokensAvailable: count.int().max(3),
                tokensSpent: count.int(),
                tokensHeld: count.int().max(3),
                actions: z.array(action).max(1000)
              })
              .passthrough()
          )
          .max(10000),
        finalRaidState: z
          .object({
            stageCode: text,
            loopIndex: count.int(),
            encounters: z.object({ 0: encounter, 1: encounter, 2: encounter })
          })
          .passthrough(),
        metrics: z.object({
          tokensSpent: count.int(),
          overkillDamage: count,
          bossesDefeated: count.int(),
          loopAdvances: count.int(),
          wastedTokens: count,
          wastedTicks: count
        }),
        warnings: z.array(z.string().max(2000)).max(1000)
      })
      .passthrough()
  })
  .passthrough()
const save = z
  .object({
    id: z.string().uuid().optional(),
    season_id: identity,
    start_at: date,
    end_at: date,
    snapshot_at: date,
    kind: z.enum(['baseline', 'replan']).optional(),
    baseline_key: z.string().max(128).nullable().optional(),
    baseline_plan_id: z.string().uuid().nullable().optional(),
    trigger: z.string().min(1).max(128).optional(),
    resolved_options: z.record(z.string(), z.unknown()).optional(),
    seed: z
      .number()
      .int()
      .min(-2147483648)
      .max(2147483647)
      .nullable()
      .optional(),
    plan_hash: z.string().max(128).nullable().optional(),
    input_snapshots: z.record(z.string(), z.unknown()).optional(),
    plan_metrics: z.record(z.string(), z.unknown()).optional(),
    plan: generated
  })
  .strict()

export function invalidPlan(message = 'Invalid saved plan'): never {
  throw Errors.fromResponse(400, { error: message })
}
export function parsePlanId(value: unknown): string {
  const result = z.string().uuid().safeParse(value)
  if (!result.success) invalidPlan('Invalid plan id')
  return result.data
}
export function parsePlanSeasonId(value: unknown): string {
  const result = identity.safeParse(value)
  if (!result.success) invalidPlan('Invalid season_id')
  return result.data
}
function boundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (depth > 30 || ++budget.nodes > 150000)
    invalidPlan('Plan exceeds supported size')
  if (typeof value === 'number' && !Number.isFinite(value)) invalidPlan()
  if (typeof value === 'string' && value.length > 16000)
    invalidPlan('Plan string exceeds supported size')
  if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalidPlan()
      boundedJson(child, depth + 1, budget)
    }
}
export function validateSavedPlan(value: unknown, guild: string) {
  boundedJson(value)
  const result = save.safeParse(value)
  if (!result.success)
    invalidPlan('Invalid saved plan identity, dates or generated payload')
  const data = result.data,
    p = data.plan
  const start = Date.parse(data.start_at),
    end = Date.parse(data.end_at),
    at = Date.parse(data.snapshot_at)
  if (start >= end || end - start > 32 * 86400000 || at < start || at >= end)
    invalidPlan('Invalid plan date window')
  if (
    p.season_id !== data.season_id ||
    p.snapshot.seasonId !== data.season_id ||
    p.snapshot.guildCode !== guild ||
    p.snapshot.season !== p.season ||
    Date.parse(p.season_start_at) !== start ||
    Date.parse(p.season_end_at) !== end ||
    Date.parse(p.snapshot_at) !== at ||
    Date.parse(p.snapshot.snapshotAt) !== at
  )
    invalidPlan('Plan identity does not match saved guild and season')
  let spent = 0
  for (const session of p.plan.sessions) {
    const time = Date.parse(session.at)
    if (
      time < at ||
      time >= end ||
      session.actions.length !== session.tokensSpent
    )
      invalidPlan('Invalid planned session')
    spent += session.tokensSpent
    if (
      session.actions.some(
        (action) =>
          action.playerId !== session.playerId || Date.parse(action.at) !== time
      )
    )
      invalidPlan('Invalid planned action identity')
  }
  if (p.plan.metrics.tokensSpent !== spent)
    invalidPlan('Plan token totals do not match sessions')
  return data
}
export async function readBoundedPlanBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) invalidPlan('Plan body required')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 2 * 1024 * 1024) {
        await reader.cancel()
        invalidPlan('Plan exceeds supported size')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    invalidPlan('Malformed plan JSON')
  }
}
