import { z } from 'zod'

export const WAR_IMPORT_LIMITS = {
  wars: 50,
  zonesPerWar: 50,
  attemptsPerZone: 50,
  participationPerWar: 100,
  assignedPlayersPerZone: 100,
  unitsPerAttempt: 20,
  stringLength: 256,
  // Matches the client's 10 MB upload limit.
  maxBytes: 10 * 1024 * 1024
} as const

const boundedString = z.string().min(1).max(WAR_IMPORT_LIMITS.stringLength)
const optionalString = z.string().max(WAR_IMPORT_LIMITS.stringLength).nullish()

const attemptImportSchema = z.object({
  // Re-imports upsert on it. Not z.string().uuid(): generateDeterministicId() emits sha256 slices
  // that break RFC 4122 nibbles, so that check would reject our own exports.
  event_id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'event_id must be a 32-hex-digit UUID-shaped string'
    )
    .nullish(),
  player_id: boundedString,
  player_name: boundedString,
  attempt_number: z.number().int().min(1),
  attempt_status: boundedString,
  attempt_result: optionalString,
  damage_dealt: z.number().nullish(),
  score_earned: z.number().nullish(),
  units_used: z
    .array(z.unknown())
    .max(WAR_IMPORT_LIMITS.unitsPerAttempt)
    .nullish(),
  attempt_start_time: optionalString,
  attempt_end_time: optionalString
})

const zoneImportSchema = z.object({
  zone_number: z.number().int().min(1),
  zone_type: boundedString,
  zone_status: boundedString,
  zone_name: optionalString,
  assigned_players: z
    .array(boundedString)
    .max(WAR_IMPORT_LIMITS.assignedPlayersPerZone)
    .nullish(),
  attempts: z
    .array(attemptImportSchema)
    .max(WAR_IMPORT_LIMITS.attemptsPerZone)
    .optional()
    .default([])
})

const participationImportSchema = z.object({
  user_id: boundedString,
  display_name: optionalString,
  role: optionalString,
  opted_in: z.boolean().nullish(),
  attempts_used: z.number().nullish(),
  attempts_remaining: z.number().nullish(),
  score: z.number().nullish(),
  exhausted_units: z.number().nullish()
})

const warImportSchema = z.object({
  war_id: boundedString,
  opponent_guild_name: boundedString,
  war_status: z.enum(['active', 'completed', 'cancelled', 'failed']),
  opponent_guild_code: optionalString,
  war_result: z.enum(['win', 'loss', 'draw']).nullish(),
  guild_score: z.number().nullish(),
  opponent_score: z.number().nullish(),
  war_start_date: optionalString,
  war_end_date: optionalString,
  war_season: z.number().nullish(),
  battlefield_level: z.number().nullish(),
  zones: z
    .array(zoneImportSchema)
    .max(WAR_IMPORT_LIMITS.zonesPerWar)
    .optional()
    .default([]),
  participation: z
    .array(participationImportSchema)
    .max(WAR_IMPORT_LIMITS.participationPerWar)
    .optional()
    .default([])
})

export const warImportPayloadSchema = z.object({
  wars: z.array(warImportSchema).min(1).max(WAR_IMPORT_LIMITS.wars)
})

export type WarImportPayload = z.infer<typeof warImportPayloadSchema>
export type WarImportData = z.infer<typeof warImportSchema>
export type ZoneImportData = z.infer<typeof zoneImportSchema>
export type AttemptImportData = z.infer<typeof attemptImportSchema>
export type ParticipationImportData = z.infer<typeof participationImportSchema>
