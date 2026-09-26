#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const path = require('node:path')

// Offline tool: timestamps derive from the checked-in GlobalConfig, so every mode is deterministic.
// Its two offsets match season-configs.ts (the unit suite compares them).
const SEASON_NUMBER_OFFSET = 10
const ROTATION_INDEX_OFFSET = 1
const WINDOW_SIZE = 5
const SCHEMA_VERSION = 'loki-season-lineups.v2'

const mod = (value, divisor) => ((value % divisor) + divisor) % divisor

const requireObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a nonblank string`)
  }
  return value
}

const requireFiniteNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const nullableString = (value, label) => {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null`)
  }
  return value
}

const nullableInteger = (value, label) => {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new Error(`${label} must be an integer or null`)
  }
  return number
}

const captureContext = (globalConfig) => {
  const root = requireObject(globalConfig, 'GlobalConfig')
  const guildBoss = requireObject(root.guildBoss, 'GlobalConfig.guildBoss')
  const misc = requireObject(guildBoss.misc, 'GlobalConfig.guildBoss.misc')
  const rotation = guildBoss.guildBossSeasonConfigRotation
  if (!Array.isArray(rotation) || rotation.length !== WINDOW_SIZE) {
    throw new Error(
      `GlobalConfig guild-boss rotation must contain exactly ${WINDOW_SIZE} configs`
    )
  }
  const configIds = rotation.map((id, index) =>
    requireString(id, `guildBossSeasonConfigRotation[${index}]`)
  )
  const configs = requireObject(
    guildBoss.guildBossSeasonDataConfigsGDTO,
    'GlobalConfig.guildBoss.guildBossSeasonDataConfigsGDTO'
  )
  for (const id of configIds) {
    requireObject(configs[id], `guild-boss config ${id}`)
  }

  const capturedAtInput = requireString(
    root.extractedAt,
    'GlobalConfig.extractedAt'
  )
  const capturedAtMs = Date.parse(capturedAtInput)
  if (!Number.isFinite(capturedAtMs)) {
    throw new Error('GlobalConfig.extractedAt must be a valid timestamp')
  }
  const capturedAt = new Date(capturedAtMs).toISOString()
  const configVersion = requireString(
    root.configVersion,
    'GlobalConfig.configVersion'
  )
  const firstSeasonStart = requireFiniteNumber(
    misc.firstSeasonStart,
    'GlobalConfig.guildBoss.misc.firstSeasonStart'
  )
  const seasonDurationSeconds = requireFiniteNumber(
    misc.seasonDuration,
    'GlobalConfig.guildBoss.misc.seasonDuration'
  )
  const seasonGapSeconds = requireFiniteNumber(
    misc.bufferAfterSeasonEnd,
    'GlobalConfig.guildBoss.misc.bufferAfterSeasonEnd'
  )
  if (seasonDurationSeconds <= 0) {
    throw new Error('GlobalConfig guild-boss season duration must be positive')
  }
  if (seasonGapSeconds < 0 || seasonGapSeconds >= seasonDurationSeconds) {
    throw new Error(
      'GlobalConfig guild-boss season gap must be non-negative and shorter than the season cycle'
    )
  }
  const firstPlayableSeasonStart = firstSeasonStart + seasonGapSeconds * 1000
  if (capturedAtMs < firstPlayableSeasonStart) {
    throw new Error(
      'GlobalConfig capture predates the first playable guild-boss season'
    )
  }

  const seasonsElapsed = Math.floor(
    (capturedAtMs - firstPlayableSeasonStart) / (seasonDurationSeconds * 1000)
  )
  const captureSeason = seasonsElapsed + 1 - SEASON_NUMBER_OFFSET
  const rotationIndex = mod(
    seasonsElapsed + ROTATION_INDEX_OFFSET,
    configIds.length
  )

  return {
    capturedAt,
    capturedAtMs,
    captureSeason,
    configVersion,
    configs,
    rotation: configIds,
    rotationIndex,
    seasonGapSeconds
  }
}

const normalizeEncounter = (rawEncounter, rarityIndex, set, location) => {
  const encounter = requireObject(rawEncounter, location)
  const encounterIndex = nullableInteger(
    encounter.encounterIndex,
    `${location}.encounterIndex`
  )
  if (encounterIndex === null) {
    throw new Error(`${location}.encounterIndex is required`)
  }

  return {
    rarityIndex,
    set,
    encounterIndex,
    encounterType: nullableString(
      encounter.guildBossEncounterType ?? encounter.encounterType,
      `${location}.guildBossEncounterType`
    ),
    bossType: requireString(encounter.bossType, `${location}.bossType`),
    unitId: nullableString(encounter.unitId, `${location}.unitId`),
    boardId: nullableString(encounter.boardId, `${location}.boardId`)
  }
}

const buildSeasonEntry = (context, offset) => {
  const configId =
    context.rotation[
      mod(context.rotationIndex + offset, context.rotation.length)
    ]
  const rawConfig = requireObject(
    context.configs[configId],
    `guild-boss config ${configId}`
  )
  if (!Array.isArray(rawConfig.tiers)) {
    throw new Error(`guild-boss config ${configId}.tiers must be an array`)
  }

  const encounters = []
  rawConfig.tiers.forEach((rawTier, rarityIndex) => {
    const tier = requireObject(
      rawTier,
      `guild-boss config ${configId}.tiers[${rarityIndex}]`
    )
    if (!Array.isArray(tier.sets)) {
      throw new Error(
        `guild-boss config ${configId}.tiers[${rarityIndex}].sets must be an array`
      )
    }
    tier.sets.forEach((rawSet, setIndex) => {
      const setRecord = requireObject(
        rawSet,
        `guild-boss config ${configId}.tiers[${rarityIndex}].sets[${setIndex}]`
      )
      const set = nullableInteger(
        setRecord.set,
        `guild-boss config ${configId}.tiers[${rarityIndex}].sets[${setIndex}].set`
      )
      if (set === null) {
        throw new Error(
          `guild-boss config ${configId}.tiers[${rarityIndex}].sets[${setIndex}].set is required`
        )
      }
      if (!Array.isArray(setRecord.encounters)) {
        throw new Error(
          `guild-boss config ${configId}.tiers[${rarityIndex}].sets[${setIndex}].encounters must be an array`
        )
      }
      setRecord.encounters.forEach((encounter, encounterArrayIndex) => {
        encounters.push(
          normalizeEncounter(
            encounter,
            rarityIndex,
            set,
            `guild-boss config ${configId}.tiers[${rarityIndex}].sets[${setIndex}].encounters[${encounterArrayIndex}]`
          )
        )
      })
    })
  })

  if (encounters.length === 0) {
    throw new Error(`guild-boss config ${configId} has no encounters`)
  }

  return {
    season: context.captureSeason + offset,
    configId,
    configVersion: context.configVersion,
    capturedAt: context.capturedAt,
    loopFromTier: nullableInteger(
      rawConfig.loopFromTier,
      `guild-boss config ${configId}.loopFromTier`
    ),
    loopFromSet: nullableInteger(
      rawConfig.loopFromSet,
      `guild-boss config ${configId}.loopFromSet`
    ),
    encounters
  }
}

const sortSeasonEntries = (seasons) =>
  Object.fromEntries(
    Object.entries(seasons).sort(
      ([left], [right]) => Number(left) - Number(right)
    )
  )

/**
 * Merges the current GlobalConfig window into the overlay. The started season is immutable, only the
 * four future entries may change, and a missing current entry fails closed.
 */
const mergeSeasonLineups = (globalConfig, existingOverlay) => {
  const context = captureContext(globalConfig)
  const existing = requireObject(existingOverlay, 'season-lineups overlay')
  const existingSeasons = requireObject(
    existing.seasons,
    'season-lineups overlay.seasons'
  )
  const currentEntry = existingSeasons[String(context.captureSeason)]
  if (!currentEntry) {
    throw new Error(
      `Cannot merge capture window: already-started season ${context.captureSeason} is missing from the overlay`
    )
  }
  const current = requireObject(
    currentEntry,
    `season-lineups overlay.seasons.${context.captureSeason}`
  )
  if (
    current.season !== context.captureSeason ||
    !Array.isArray(current.encounters) ||
    current.encounters.length === 0
  ) {
    throw new Error(
      `Cannot merge capture window: already-started season ${context.captureSeason} is malformed`
    )
  }
  if (existing.generatedAt != null) {
    const existingGeneratedAt = Date.parse(
      requireString(existing.generatedAt, 'season-lineups overlay.generatedAt')
    )
    if (!Number.isFinite(existingGeneratedAt)) {
      throw new Error('season-lineups overlay.generatedAt must be a timestamp')
    }
    if (existingGeneratedAt > context.capturedAtMs) {
      throw new Error(
        'Bundled GlobalConfig capture is older than the season-lineups overlay'
      )
    }
  }

  const seasons = JSON.parse(JSON.stringify(existingSeasons))
  const updatedSeasons = []
  for (let offset = 1; offset < WINDOW_SIZE; offset += 1) {
    const entry = buildSeasonEntry(context, offset)
    seasons[String(entry.season)] = entry
    updatedSeasons.push(entry.season)
  }

  const sources = Array.isArray(existing.sources)
    ? JSON.parse(JSON.stringify(existing.sources))
    : []
  const source = {
    configVersion: context.configVersion,
    capturedAt: context.capturedAt,
    captureSeason: context.captureSeason,
    window: [context.captureSeason, context.captureSeason + WINDOW_SIZE - 1]
  }
  const sourceIndex = sources.findIndex(
    (candidate) =>
      candidate?.configVersion === source.configVersion &&
      candidate?.capturedAt === source.capturedAt &&
      candidate?.captureSeason === source.captureSeason
  )
  if (sourceIndex >= 0) sources[sourceIndex] = source
  else sources.push(source)

  return {
    overlay: {
      ...existing,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: context.capturedAt,
      sources,
      seasons: sortSeasonEntries(seasons)
    },
    context,
    updatedSeasons
  }
}

const renderOverlay = (overlay) => `${JSON.stringify(overlay, null, 2)}\n`

const parseCliArgs = (argv) => {
  const options = {
    check: false,
    dryRun: false,
    globalConfigPath: null,
    overlayPath: null
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      options.check = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--global-config' || arg === '--overlay') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a file path`)
      }
      if (arg === '--global-config') options.globalConfigPath = value
      else options.overlayPath = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (options.check && options.dryRun) {
    throw new Error('Use either --check or --dry-run, not both')
  }
  return options
}

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Failed to read ${label} at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

const runCli = (argv, io = console) => {
  const options = parseCliArgs(argv)
  const repositoryRoot = path.resolve(__dirname, '..', '..')
  const globalConfigPath = path.resolve(
    options.globalConfigPath ??
      path.join(repositoryRoot, 'data', 'loki-api', 'GlobalConfig.json')
  )
  const overlayPath = path.resolve(
    options.overlayPath ??
      path.join(repositoryRoot, 'data', 'loki-api', 'season-lineups.json')
  )
  const original = fs.readFileSync(overlayPath, 'utf8')
  const globalConfig = readJson(globalConfigPath, 'GlobalConfig')
  const existingOverlay = readJson(overlayPath, 'season-lineups overlay')
  const result = mergeSeasonLineups(globalConfig, existingOverlay)
  const rendered = renderOverlay(result.overlay)
  const changed = original !== rendered
  const windowEnd = result.context.captureSeason + WINDOW_SIZE - 1
  const summary = `season-lineups ${result.context.captureSeason}-${windowEnd} (${result.context.configVersion}); future seasons ${result.updatedSeasons.join(', ')}`

  if (options.check) {
    if (changed) {
      io.error(`${summary}: overlay is stale; run npm run loki:season-lineups`)
      return 1
    }
    io.log(`${summary}: overlay is current`)
    return 0
  }

  if (options.dryRun) {
    io.log(`${summary}: ${changed ? 'would update overlay' : 'no changes'}`)
    return 0
  }

  if (changed) {
    fs.writeFileSync(overlayPath, rendered)
    io.log(`${summary}: updated ${overlayPath}`)
  } else {
    io.log(`${summary}: no changes`)
  }
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  ROTATION_INDEX_OFFSET,
  SCHEMA_VERSION,
  SEASON_NUMBER_OFFSET,
  WINDOW_SIZE,
  buildSeasonEntry,
  captureContext,
  mergeSeasonLineups,
  parseCliArgs,
  renderOverlay,
  runCli
}
