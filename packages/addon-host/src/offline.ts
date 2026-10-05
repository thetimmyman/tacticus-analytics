import { z } from 'zod'
import { canonicalJson } from './contract'

export const IMPORT_LIMITS = Object.freeze({
  bytes: 2_097_152,
  battles: 10_000,
  events: 20_000,
  entities: 100,
  durationMs: 3_600_000
})
const battle = z
  .object({
    battle: z.number().int().min(1).max(10_000),
    attackerSlot: z.number().int().min(1).max(30),
    zone: z.number().int().min(1).max(25),
    points: z.number().int().min(0).max(1_000_000),
    outcome: z.enum(['victory', 'defeat']),
    occurredAt: z.number().int().min(0).max(4_102_444_800)
  })
  .strict()
export const warSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal('ta-war-summary-v1'),
    season: z.number().int().min(1).max(100_000),
    battles: z.array(battle).max(IMPORT_LIMITS.battles)
  })
  .strict()
const eventBase = {
  at: z.number().int().min(0).max(IMPORT_LIMITS.durationMs),
  entity: z.number().int().min(1).max(IMPORT_LIMITS.entities)
}
const coordinate = z.number().int().min(0).max(100)
export const replayEvent = z.discriminatedUnion('type', [
  z
    .object({
      ...eventBase,
      type: z.literal('spawn'),
      side: z.enum(['allies', 'opponents']),
      x: coordinate,
      y: coordinate,
      hp: z.number().int().min(1).max(1_000_000)
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('move'),
      x: coordinate,
      y: coordinate
    })
    .strict(),
  z
    .object({
      ...eventBase,
      type: z.literal('damage'),
      amount: z.number().int().min(0).max(1_000_000)
    })
    .strict(),
  z.object({ ...eventBase, type: z.literal('remove') }).strict()
])
export const replaySchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal('ta-replay-timeline-v1'),
    durationMs: z.number().int().min(1).max(IMPORT_LIMITS.durationMs),
    events: z.array(replayEvent).min(1).max(IMPORT_LIMITS.events)
  })
  .strict()
export type WarSummary = z.infer<typeof warSchema>
export type ReplayTimeline = z.infer<typeof replaySchema>
export type ReplayEntity = {
  entity: number
  side: 'allies' | 'opponents'
  x: number
  y: number
  hp: number
}

export class ImportError extends Error {
  constructor() {
    super('Unsupported or malformed local import')
    this.name = 'ImportError'
  }
}

export function parseOfflineImport(
  addon: 'guild-war' | 'replays',
  input: string
): WarSummary | ReplayTimeline {
  try {
    if (Buffer.byteLength(input, 'utf8') > IMPORT_LIMITS.bytes)
      throw new ImportError()
    // Only plain JSON is accepted. Archives and game binary formats are unsupported.
    const json: unknown = JSON.parse(input)
    if (addon === 'guild-war') {
      const parsed = warSchema.parse(json)
      if (
        new Set(parsed.battles.map((entry) => entry.battle)).size !==
        parsed.battles.length
      )
        throw new ImportError()
      return parsed
    }
    const parsed = replaySchema.parse(json)
    let previous = -1
    const active = new Set<number>()
    for (const event of parsed.events) {
      if (event.at < previous || event.at > parsed.durationMs)
        throw new ImportError()
      previous = event.at
      if (event.type === 'spawn') {
        if (active.has(event.entity)) throw new ImportError()
        active.add(event.entity)
      } else if (!active.has(event.entity)) throw new ImportError()
      if (event.type === 'remove') active.delete(event.entity)
    }
    return parsed
  } catch {
    throw new ImportError()
  }
}

export function summarizeWar(input: WarSummary) {
  const players = Array.from({ length: 30 }, (_, index) => ({
    slot: index + 1,
    battles: 0,
    victories: 0,
    points: 0
  }))
  const zones = Array.from({ length: 25 }, (_, index) => ({
    zone: index + 1,
    battles: 0,
    points: 0
  }))
  for (const entry of input.battles) {
    players[entry.attackerSlot - 1].battles += 1
    players[entry.attackerSlot - 1].victories += Number(
      entry.outcome === 'victory'
    )
    players[entry.attackerSlot - 1].points += entry.points
    zones[entry.zone - 1].battles += 1
    zones[entry.zone - 1].points += entry.points
  }
  return {
    provenance: 'locally-supplied-unverified' as const,
    season: input.season,
    battles: input.battles.length,
    points: players.reduce((sum, player) => sum + player.points, 0),
    players: players.filter((player) => player.battles > 0),
    zones: zones.filter((zone) => zone.battles > 0)
  }
}

export function replayFrame(
  input: ReplayTimeline,
  timeMs: number
): {
  provenance: 'locally-supplied-unverified'
  timeMs: number
  entities: ReplayEntity[]
} {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > input.durationMs)
    throw new ImportError()
  const entities = new Map<number, ReplayEntity>()
  for (const event of input.events) {
    if (event.at > timeMs) break
    if (event.type === 'spawn')
      entities.set(event.entity, {
        entity: event.entity,
        side: event.side,
        x: event.x,
        y: event.y,
        hp: event.hp
      })
    if (event.type === 'remove') entities.delete(event.entity)
    const entity = entities.get(event.entity)
    if (event.type === 'move' && entity)
      Object.assign(entity, { x: event.x, y: event.y })
    if (event.type === 'damage' && entity)
      entity.hp = Math.max(0, entity.hp - event.amount)
  }
  return {
    provenance: 'locally-supplied-unverified',
    timeMs,
    entities: [...entities.values()].sort((a, b) => a.entity - b.entity)
  }
}

export function normalizedImport(
  addon: 'guild-war' | 'replays',
  input: string
): string {
  return canonicalJson(parseOfflineImport(addon, input))
}
