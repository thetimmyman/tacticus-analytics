import { createHash } from 'node:crypto'

export const GUILD_WAR_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxBattles: 10000,
  maxPlayers: 30,
  maxZones: 25,
  maxPointsPerBattle: 1000000
})

export class GuildWarValidationError extends Error {
  constructor(message, code = 'EGUILD_WAR_VALIDATION') {
    super(message)
    this.name = 'GuildWarValidationError'
    this.code = code
  }
}

/**
 * Validates raw JSON Guild War summary payload.
 * Enforces schema version, battle limits, unique battle numbers,
 * slot/zone ranges, and sanitization of active-content fields.
 */
export function validateGuildWarSummary(rawInput, expectedGuildCode = null) {
  if (typeof rawInput !== 'string') {
    throw new GuildWarValidationError(
      'Guild War input must be a JSON string',
      'EINVALID_INPUT'
    )
  }

  const byteLength = Buffer.byteLength(rawInput, 'utf8')
  if (byteLength > GUILD_WAR_LIMITS.maxBytes) {
    throw new GuildWarValidationError(
      `Guild War file exceeds limit of ${GUILD_WAR_LIMITS.maxBytes} bytes`,
      'EFILE_TOO_LARGE'
    )
  }

  // Active content and traversal checks
  if (
    /<script[\s>]/i.test(rawInput) ||
    /javascript:/i.test(rawInput) ||
    /on\w+\s*=/i.test(rawInput) ||
    /\.\.\//.test(rawInput)
  ) {
    throw new GuildWarValidationError(
      'Payload contains forbidden active script or traversal content',
      'EHOSTILE_PAYLOAD'
    )
  }

  let parsed
  try {
    parsed = JSON.parse(rawInput)
  } catch {
    throw new GuildWarValidationError(
      'Malformed JSON payload',
      'EMALFORMED_JSON'
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GuildWarValidationError(
      'Root payload must be an object',
      'EINVALID_STRUCTURE'
    )
  }

  if (parsed.format !== 'ta-war-summary-v1') {
    throw new GuildWarValidationError(
      `Unsupported format '${parsed.format}'. Only 'ta-war-summary-v1' is supported`,
      'EUNSUPPORTED_FORMAT'
    )
  }

  if (parsed.schemaVersion !== 1) {
    throw new GuildWarValidationError(
      `Unsupported schema version '${parsed.schemaVersion}'. Supported version is 1`,
      'EUNSUPPORTED_VERSION'
    )
  }

  if (
    expectedGuildCode &&
    parsed.guildCode &&
    parsed.guildCode !== expectedGuildCode
  ) {
    throw new GuildWarValidationError(
      `Cross-guild mismatch: payload belongs to guild '${parsed.guildCode}', but active session is '${expectedGuildCode}'`,
      'ECROSS_GUILD_MISMATCH'
    )
  }

  if (!Number.isSafeInteger(parsed.season) || parsed.season < 1) {
    throw new GuildWarValidationError(
      'Invalid season number',
      'EINVALID_SEASON'
    )
  }

  if (!Array.isArray(parsed.battles)) {
    throw new GuildWarValidationError(
      'Battles must be an array',
      'EINVALID_BATTLES'
    )
  }

  if (parsed.battles.length > GUILD_WAR_LIMITS.maxBattles) {
    throw new GuildWarValidationError(
      'Battle count exceeds maximum limit',
      'EBATTLE_LIMIT_EXCEEDED'
    )
  }

  const battleIds = new Set()
  for (let i = 0; i < parsed.battles.length; i++) {
    const b = parsed.battles[i]
    if (!b || typeof b !== 'object') {
      throw new GuildWarValidationError(
        `Battle at index ${i} is not a valid object`,
        'EMALFORMED_BATTLE'
      )
    }

    if (!Number.isSafeInteger(b.battle) || b.battle < 1) {
      throw new GuildWarValidationError(
        `Invalid battle ID at index ${i}`,
        'EINVALID_BATTLE_ID'
      )
    }
    if (battleIds.has(b.battle)) {
      throw new GuildWarValidationError(
        `Duplicate battle ID ${b.battle} at index ${i}`,
        'EDUPLICATE_BATTLE'
      )
    }
    battleIds.add(b.battle)

    if (
      !Number.isSafeInteger(b.attackerSlot) ||
      b.attackerSlot < 1 ||
      b.attackerSlot > GUILD_WAR_LIMITS.maxPlayers
    ) {
      throw new GuildWarValidationError(
        `Attacker slot out of range [1-30] at index ${i}`,
        'ESLOT_OUT_OF_RANGE'
      )
    }

    if (
      !Number.isSafeInteger(b.zone) ||
      b.zone < 1 ||
      b.zone > GUILD_WAR_LIMITS.maxZones
    ) {
      throw new GuildWarValidationError(
        `Zone out of range [1-25] at index ${i}`,
        'EZONE_OUT_OF_RANGE'
      )
    }

    if (
      !Number.isSafeInteger(b.points) ||
      b.points < 0 ||
      b.points > GUILD_WAR_LIMITS.maxPointsPerBattle
    ) {
      throw new GuildWarValidationError(
        `Points out of valid range at index ${i}`,
        'EPOINTS_OUT_OF_RANGE'
      )
    }

    if (!['victory', 'defeat'].includes(b.outcome)) {
      throw new GuildWarValidationError(
        `Invalid battle outcome '${b.outcome}' at index ${i}`,
        'EINVALID_OUTCOME'
      )
    }
  }

  return {
    summary: parsed,
    totalBattles: parsed.battles.length,
    season: parsed.season
  }
}

/**
 * Guild War Analytics Engine for detailed local tactical insights.
 */
export class GuildWarAnalyticsEngine {
  constructor(summary) {
    this.summary = summary
    this.season = summary.season
    this.battles = summary.battles
  }

  /**
   * Computes comprehensive zone-by-zone, player-by-player, and tactical performance analytics.
   */
  computeTacticalAnalysis() {
    const playerStats = new Map()
    const zoneStats = new Map()

    for (let slot = 1; slot <= GUILD_WAR_LIMITS.maxPlayers; slot++) {
      playerStats.set(slot, {
        slot,
        battles: 0,
        victories: 0,
        defeats: 0,
        points: 0,
        winRate: 0
      })
    }

    for (let zone = 1; zone <= GUILD_WAR_LIMITS.maxZones; zone++) {
      zoneStats.set(zone, { zone, battles: 0, points: 0, cleared: false })
    }

    let totalPoints = 0
    let totalVictories = 0

    for (const b of this.battles) {
      const p = playerStats.get(b.attackerSlot)
      p.battles += 1
      p.points += b.points
      if (b.outcome === 'victory') {
        p.victories += 1
        totalVictories += 1
      } else {
        p.defeats += 1
      }

      const z = zoneStats.get(b.zone)
      z.battles += 1
      z.points += b.points

      totalPoints += b.points
    }

    // Calculate win rates
    for (const p of playerStats.values()) {
      p.winRate =
        p.battles > 0 ? Math.round((p.victories / p.battles) * 100) : 0
    }

    // Active participants
    const activePlayers = Array.from(playerStats.values())
      .filter((p) => p.battles > 0)
      .sort((a, b) => b.points - a.points)

    const activeZones = Array.from(zoneStats.values())
      .filter((z) => z.battles > 0)
      .sort((a, b) => a.zone - b.zone)

    return {
      provenance: 'locally-supplied-unverified',
      season: this.season,
      totalBattles: this.battles.length,
      totalPoints,
      overallWinRate:
        this.battles.length > 0
          ? Math.round((totalVictories / this.battles.length) * 100)
          : 0,
      activePlayerCount: activePlayers.length,
      topAttacker: activePlayers[0] ?? null,
      players: activePlayers,
      zones: activeZones
    }
  }
}

/**
 * Retains historical war results across seasons and acquisition sessions.
 * Never deletes or corrupts historical data on failure.
 */
export class GuildWarHistoryStore {
  constructor(db) {
    this.db = db
    this.init()
  }

  init() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_war_history (
        season INTEGER NOT NULL,
        guild_code TEXT NOT NULL,
        total_battles INTEGER NOT NULL,
        total_points INTEGER NOT NULL,
        analysis_json TEXT NOT NULL,
        stored_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        PRIMARY KEY (season, guild_code)
      );
    `)
  }

  storeRun(guildCode, analysis) {
    if (!this.db) return
    this.db
      .prepare(
        `
      INSERT INTO guild_war_history (season, guild_code, total_battles, total_points, analysis_json, stored_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'utc'))
      ON CONFLICT(season, guild_code) DO UPDATE SET
        total_battles = excluded.total_battles,
        total_points = excluded.total_points,
        analysis_json = excluded.analysis_json,
        stored_at = excluded.stored_at
    `
      )
      .run(
        analysis.season,
        guildCode,
        analysis.totalBattles,
        analysis.totalPoints,
        JSON.stringify(analysis)
      )
  }

  getRun(season, guildCode) {
    if (!this.db) return null
    const row = this.db
      .prepare(
        `
      SELECT * FROM guild_war_history WHERE season = ? AND guild_code = ?
    `
      )
      .get(season, guildCode)
    if (!row) return null
    return {
      ...row,
      analysis: JSON.parse(row.analysis_json)
    }
  }

  listRuns(guildCode) {
    if (!this.db) return []
    return this.db
      .prepare(
        `
      SELECT season, guild_code, total_battles, total_points, stored_at
      FROM guild_war_history
      WHERE guild_code = ?
      ORDER BY season DESC
    `
      )
      .all(guildCode)
  }
}

/**
 * Sanitizes Guild War data for optional publisher upload.
 * Strictly excludes member game credentials, player mapping secrets,
 * and individual unapproved event traces.
 */
export function sanitizeGuildWarForPublication(
  summary,
  { optInStatsConsent = false } = {}
) {
  if (!optInStatsConsent) {
    throw new GuildWarValidationError(
      'Publishing war statistics requires explicit user opt-in consent',
      'ECONSENT_REQUIRED'
    )
  }

  const engine = new GuildWarAnalyticsEngine(summary)
  const analysis = engine.computeTacticalAnalysis()

  const datasetDigest = createHash('sha256')
    .update(
      `war:season:${analysis.season};points:${analysis.totalPoints};battles:${analysis.totalBattles}`
    )
    .digest('hex')

  return {
    schemaVersion: 1,
    format: 'ta-war-public-summary-v1',
    datasetDigest,
    season: analysis.season,
    totalBattles: analysis.totalBattles,
    totalPoints: analysis.totalPoints,
    overallWinRate: analysis.overallWinRate,
    activePlayerCount: analysis.activePlayerCount,
    zoneAggregates: analysis.zones.map((z) => ({
      zone: z.zone,
      points: z.points
    })),
    anonymized: true,
    provenance: 'locally-supplied-unverified'
  }
}
