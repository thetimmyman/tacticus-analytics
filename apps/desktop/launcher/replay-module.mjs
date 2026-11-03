import { createHash } from 'node:crypto'

export const REPLAY_IMPORT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024, // 2MB max file size
  maxEvents: 20000,
  maxEntities: 100,
  maxDurationMs: 3600000, // 1 hour max playback duration
  maxCoordinate: 100
})

export class ReplayValidationError extends Error {
  constructor(message, code = 'EREPLAY_VALIDATION') {
    super(message)
    this.name = 'ReplayValidationError'
    this.code = code
  }
}

/**
 * Validates and sanitizes raw JSON replay payload.
 * Applies size limits, schema checks, monotonic timestamps, entity lifecycle,
 * and active-content/directory-traversal protection.
 */
export function validateReplayTimeline(rawInput) {
  if (typeof rawInput !== 'string') {
    throw new ReplayValidationError(
      'Replay input must be a JSON string',
      'EINVALID_INPUT'
    )
  }

  const byteLength = Buffer.byteLength(rawInput, 'utf8')
  if (byteLength > REPLAY_IMPORT_LIMITS.maxBytes) {
    throw new ReplayValidationError(
      `Replay file exceeds maximum permitted size of ${REPLAY_IMPORT_LIMITS.maxBytes} bytes`,
      'EFILE_TOO_LARGE'
    )
  }

  // Active content and traversal checks
  if (
    /<script[\s>]/i.test(rawInput) ||
    /javascript:/i.test(rawInput) ||
    /on\w+\s*=/i.test(rawInput) ||
    /\.\.\//.test(rawInput) ||
    /\.\.\\/.test(rawInput)
  ) {
    throw new ReplayValidationError(
      'Replay payload contains forbidden active content or path traversal sequences',
      'EHOSTILE_PAYLOAD'
    )
  }

  let parsed
  try {
    parsed = JSON.parse(rawInput)
  } catch {
    throw new ReplayValidationError('Malformed JSON payload', 'EMALFORMED_JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ReplayValidationError(
      'Root payload must be an object',
      'EINVALID_STRUCTURE'
    )
  }

  // Schema and format check
  if (parsed.format !== 'ta-replay-timeline-v1') {
    throw new ReplayValidationError(
      `Unsupported replay format '${parsed.format}'. Only 'ta-replay-timeline-v1' is supported`,
      'EUNSUPPORTED_FORMAT'
    )
  }

  if (parsed.schemaVersion !== 1) {
    throw new ReplayValidationError(
      `Unsupported schema version '${parsed.schemaVersion}'. Supported version is 1`,
      'EUNSUPPORTED_VERSION'
    )
  }

  const durationMs = parsed.durationMs
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > REPLAY_IMPORT_LIMITS.maxDurationMs
  ) {
    throw new ReplayValidationError(
      `Invalid durationMs: must be between 1 and ${REPLAY_IMPORT_LIMITS.maxDurationMs}`,
      'EINVALID_DURATION'
    )
  }

  if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
    throw new ReplayValidationError(
      'Events must be a non-empty array',
      'EEMPTY_EVENTS'
    )
  }

  if (parsed.events.length > REPLAY_IMPORT_LIMITS.maxEvents) {
    throw new ReplayValidationError(
      `Event count exceeds maximum of ${REPLAY_IMPORT_LIMITS.maxEvents}`,
      'EEVENT_COUNT_EXCEEDED'
    )
  }

  // Disallow forbidden metadata or extra keys that could carry uninspected properties
  const allowedRootKeys = new Set([
    'schemaVersion',
    'format',
    'durationMs',
    'events',
    'metadata'
  ])
  for (const key of Object.keys(parsed)) {
    if (!allowedRootKeys.has(key)) {
      throw new ReplayValidationError(
        `Unexpected root key '${key}'`,
        'EUNEXPECTED_PROPERTY'
      )
    }
  }

  // Validate event sequences and entity state transitions
  let previousAt = 0
  const activeEntities = new Map() // entityId -> { side, hp, x, y }
  const spawnedEver = new Set()

  for (let i = 0; i < parsed.events.length; i++) {
    const event = parsed.events[i]
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new ReplayValidationError(
        `Event at index ${i} is not a valid object`,
        'EMALFORMED_EVENT'
      )
    }

    const { type, at, entity } = event

    if (!Number.isSafeInteger(at) || at < previousAt || at > durationMs) {
      throw new ReplayValidationError(
        `Event at index ${i} has invalid or non-monotonic timestamp ${at} (previous: ${previousAt}, max: ${durationMs})`,
        'ENON_MONOTONIC_TIMESTAMP'
      )
    }
    previousAt = at

    if (
      !Number.isSafeInteger(entity) ||
      entity < 1 ||
      entity > REPLAY_IMPORT_LIMITS.maxEntities
    ) {
      throw new ReplayValidationError(
        `Event at index ${i} specifies entity ID ${entity} out of bounds [1, ${REPLAY_IMPORT_LIMITS.maxEntities}]`,
        'EENTITY_OUT_OF_BOUNDS'
      )
    }

    switch (type) {
      case 'spawn': {
        if (activeEntities.has(entity)) {
          throw new ReplayValidationError(
            `Duplicate spawn for already active entity ${entity} at index ${i}`,
            'EDUPLICATE_SPAWN'
          )
        }
        if (!['allies', 'opponents'].includes(event.side)) {
          throw new ReplayValidationError(
            `Invalid entity side '${event.side}' at index ${i}`,
            'EINVALID_SIDE'
          )
        }
        const { x, y, hp } = event
        if (
          !Number.isSafeInteger(x) ||
          x < 0 ||
          x > REPLAY_IMPORT_LIMITS.maxCoordinate ||
          !Number.isSafeInteger(y) ||
          y < 0 ||
          y > REPLAY_IMPORT_LIMITS.maxCoordinate
        ) {
          throw new ReplayValidationError(
            `Coordinate out of bounds [0, ${REPLAY_IMPORT_LIMITS.maxCoordinate}] for spawn at index ${i}`,
            'ECOORDINATE_OUT_OF_BOUNDS'
          )
        }
        if (!Number.isSafeInteger(hp) || hp < 1 || hp > 10000000) {
          throw new ReplayValidationError(
            `Invalid HP value ${hp} at index ${i}`,
            'EINVALID_HP'
          )
        }
        activeEntities.set(entity, { side: event.side, hp, x, y })
        spawnedEver.add(entity)
        break
      }

      case 'move': {
        if (!activeEntities.has(entity)) {
          throw new ReplayValidationError(
            `Move event for non-active entity ${entity} at index ${i}`,
            'EENTITY_NOT_FOUND'
          )
        }
        const { x, y } = event
        if (
          !Number.isSafeInteger(x) ||
          x < 0 ||
          x > REPLAY_IMPORT_LIMITS.maxCoordinate ||
          !Number.isSafeInteger(y) ||
          y < 0 ||
          y > REPLAY_IMPORT_LIMITS.maxCoordinate
        ) {
          throw new ReplayValidationError(
            `Coordinate out of bounds [0, ${REPLAY_IMPORT_LIMITS.maxCoordinate}] for move at index ${i}`,
            'ECOORDINATE_OUT_OF_BOUNDS'
          )
        }
        const state = activeEntities.get(entity)
        state.x = x
        state.y = y
        break
      }

      case 'damage': {
        if (!activeEntities.has(entity)) {
          throw new ReplayValidationError(
            `Damage event for non-active entity ${entity} at index ${i}`,
            'EENTITY_NOT_FOUND'
          )
        }
        const { amount } = event
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10000000) {
          throw new ReplayValidationError(
            `Invalid damage amount ${amount} at index ${i}`,
            'EINVALID_DAMAGE'
          )
        }
        const state = activeEntities.get(entity)
        state.hp = Math.max(0, state.hp - amount)
        break
      }

      case 'remove': {
        if (!activeEntities.has(entity)) {
          throw new ReplayValidationError(
            `Remove event for non-active entity ${entity} at index ${i}`,
            'EENTITY_NOT_FOUND'
          )
        }
        activeEntities.delete(entity)
        break
      }

      default:
        throw new ReplayValidationError(
          `Unknown event type '${type}' at index ${i}`,
          'EUNKNOWN_EVENT_TYPE'
        )
    }
  }

  return {
    timeline: parsed,
    totalEntities: spawnedEver.size,
    eventCount: parsed.events.length,
    durationMs
  }
}

/**
 * Replay Playback Engine for deterministic offline timeline projection.
 */
export class ReplayPlaybackEngine {
  constructor(timeline) {
    this.timeline = timeline
    this.durationMs = timeline.durationMs
    this.currentTimeMs = 0
    this.playing = false
  }

  /**
   * Projects active entities at an exact timestamp.
   */
  projectFrame(timeMs) {
    if (
      !Number.isSafeInteger(timeMs) ||
      timeMs < 0 ||
      timeMs > this.durationMs
    ) {
      throw new ReplayValidationError(
        `Seek timestamp ${timeMs} is out of bounds [0, ${this.durationMs}]`,
        'ESEEK_OUT_OF_BOUNDS'
      )
    }

    const entities = new Map()

    for (const event of this.timeline.events) {
      if (event.at > timeMs) break

      if (event.type === 'spawn') {
        entities.set(event.entity, {
          entity: event.entity,
          side: event.side,
          x: event.x,
          y: event.y,
          hp: event.hp,
          maxHp: event.hp
        })
      } else if (event.type === 'move') {
        const ent = entities.get(event.entity)
        if (ent) {
          ent.x = event.x
          ent.y = event.y
        }
      } else if (event.type === 'damage') {
        const ent = entities.get(event.entity)
        if (ent) {
          ent.hp = Math.max(0, ent.hp - event.amount)
        }
      } else if (event.type === 'remove') {
        entities.delete(event.entity)
      }
    }

    return {
      provenance: 'locally-supplied-unverified',
      timeMs,
      entities: Array.from(entities.values()).sort(
        (a, b) => a.entity - b.entity
      )
    }
  }

  /**
   * Calculates overall combat summary metrics from the timeline without leaking proprietary internals.
   */
  getSummaryMetrics() {
    let totalAlliedDamage = 0
    let totalOpponentDamage = 0
    const entityDamageMap = new Map()

    for (const event of this.timeline.events) {
      if (event.type === 'damage') {
        entityDamageMap.set(
          event.entity,
          (entityDamageMap.get(event.entity) || 0) + event.amount
        )
      }
    }

    // Determine initial entity sides
    const entitySides = new Map()
    for (const event of this.timeline.events) {
      if (event.type === 'spawn' && !entitySides.has(event.entity)) {
        entitySides.set(event.entity, event.side)
      }
    }

    for (const [entityId, damage] of entityDamageMap.entries()) {
      const side = entitySides.get(entityId)
      if (side === 'opponents') {
        totalAlliedDamage += damage // Damage dealt to opponents
      } else if (side === 'allies') {
        totalOpponentDamage += damage // Damage dealt to allies
      }
    }

    return {
      durationMs: this.durationMs,
      totalEvents: this.timeline.events.length,
      alliedDamageDealt: totalAlliedDamage,
      alliedDamageTaken: totalOpponentDamage,
      entitiesCount: entitySides.size
    }
  }
}

/**
 * Redistributable Asset and Visual Placeholder Manifest.
 * Strictly guarantees that no proprietary extracted game art or unlicensed textures
 * are packaged or required for replay visualization.
 */
export const REPLAY_ASSET_MANIFEST = Object.freeze({
  renderingEngine: 'vector-svg-board-v1',
  proprietaryAssetsIncluded: false,
  boardTheme: {
    gridType: 'hexagonal-synthetic',
    backgroundColor: '#1a1f26',
    gridLineColor: '#2d3748',
    cellRadiusPx: 24
  },
  tokenPlaceholders: {
    allies: {
      shape: 'circle',
      fillColor: '#3182ce',
      borderColor: '#63b3ed',
      textColor: '#ffffff'
    },
    opponents: {
      shape: 'hexagon',
      fillColor: '#e53e3e',
      borderColor: '#feb2b2',
      textColor: '#ffffff'
    }
  },
  healthBar: {
    heightPx: 4,
    backgroundColor: '#4a5568',
    fillColorHealthy: '#38a169',
    fillColorDamaged: '#dd6b20',
    fillColorCritical: '#e53e3e'
  }
})

/**
 * Sanitizes replay data for optional publisher submission.
 * Strictly strips raw event streams, individual action payloads,
 * credentials, and personal player tokens.
 * Only purpose-limited aggregate statistics enter the public schema.
 */
export function sanitizeReplayForPublication(
  timeline,
  { optInStatsConsent = false } = {}
) {
  if (!optInStatsConsent) {
    throw new ReplayValidationError(
      'Publishing statistics requires explicit user opt-in consent',
      'ECONSENT_REQUIRED'
    )
  }

  const engine = new ReplayPlaybackEngine(timeline)
  const metrics = engine.getSummaryMetrics()

  // Generate anonymous deterministic dataset hash
  const datasetDigest = createHash('sha256')
    .update(
      `duration:${metrics.durationMs};alliedDamage:${metrics.alliedDamageDealt}`
    )
    .digest('hex')

  return {
    schemaVersion: 1,
    format: 'ta-replay-summary-v1',
    datasetDigest,
    metrics: {
      durationMs: metrics.durationMs,
      totalEvents: metrics.totalEvents,
      alliedDamageDealt: metrics.alliedDamageDealt,
      entitiesCount: metrics.entitiesCount
    },
    rawEventsIncluded: false,
    anonymized: true,
    provenance: 'locally-supplied-unverified'
  }
}
