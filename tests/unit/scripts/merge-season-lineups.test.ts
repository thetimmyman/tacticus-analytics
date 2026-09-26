import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ROTATION_INDEX_OFFSET as RUNTIME_ROTATION_INDEX_OFFSET,
  SEASON_NUMBER_OFFSET as RUNTIME_SEASON_NUMBER_OFFSET
} from '@/app/lib/loki/season-configs'

type JsonObject = Record<string, unknown>

interface MergeContext {
  captureSeason: number
  configVersion: string
  capturedAt: string
  rotationIndex: number
  seasonGapSeconds: number
}

interface MergeResult {
  overlay: {
    generatedAt: string
    sources: Array<{
      configVersion: string
      capturedAt: string
      captureSeason: number
      window: [number, number]
    }>
    seasons: Record<
      string,
      {
        season: number
        configId: string
        configVersion: string
        capturedAt: string
        loopFromTier: number | null
        loopFromSet: number | null
        encounters: Array<Record<string, unknown>>
      }
    >
  }
  context: MergeContext
  updatedSeasons: number[]
}

interface MergeModule {
  ROTATION_INDEX_OFFSET: number
  SEASON_NUMBER_OFFSET: number
  captureContext: (config: JsonObject) => MergeContext
  mergeSeasonLineups: (config: JsonObject, overlay: JsonObject) => MergeResult
  renderOverlay: (overlay: JsonObject) => string
  runCli: (
    args: string[],
    io?: { log: (message: string) => void; error: (message: string) => void }
  ) => number
}

const require = createRequire(import.meta.url)
const merger = require(
  path.join(process.cwd(), 'scripts/loki/merge-season-lineups.cjs')
) as MergeModule

const readJson = (relativePath: string): JsonObject =>
  JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8'))

const GLOBAL_CONFIG = readJson('data/loki-api/GlobalConfig.json')
const EXISTING_OVERLAY = readJson('data/loki-api/season-lineups.json')
// Same capture time as the baked snapshot, different configVersion, so future seasons update.
const FIXTURE_CAPTURED_AT = GLOBAL_CONFIG.extractedAt as string
const FIXTURE_GLOBAL_CONFIG = {
  ...structuredClone(GLOBAL_CONFIG),
  configVersion: 'fixture-config-version',
  extractedAt: FIXTURE_CAPTURED_AT
}

const temporaryDirectories: string[] = []

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('merge-season-lineups maintenance tool', () => {
  it('shares the runtime season-number and rotation offsets', () => {
    expect(merger.SEASON_NUMBER_OFFSET).toBe(RUNTIME_SEASON_NUMBER_OFFSET)
    expect(merger.ROTATION_INDEX_OFFSET).toBe(RUNTIME_ROTATION_INDEX_OFFSET)
  })

  it('derives the current five-season window and changes future seasons only', () => {
    const before = structuredClone(EXISTING_OVERLAY) as {
      seasons: Record<string, unknown>
    }
    const result = merger.mergeSeasonLineups(
      FIXTURE_GLOBAL_CONFIG,
      EXISTING_OVERLAY
    )

    expect(result.context).toMatchObject({
      captureSeason: 110,
      configVersion: 'fixture-config-version',
      capturedAt: FIXTURE_CAPTURED_AT,
      seasonGapSeconds: 86_400
    })
    expect(result.updatedSeasons).toEqual([111, 112, 113, 114])

    // S110 had started at capture time; its earlier capture must not be rewritten.
    expect(result.overlay.seasons['110']).toEqual(before.seasons['110'])
    for (const season of [101, 102, 103, 104, 105, 106, 107, 108, 109]) {
      expect(result.overlay.seasons[String(season)]).toEqual(
        before.seasons[String(season)]
      )
    }

    expect(
      [111, 112, 113, 114].map(
        (season) => result.overlay.seasons[String(season)]?.configId
      )
    ).toEqual([
      'guild_boss_season_config_2',
      'guild_boss_season_config_3',
      'guild_boss_season_config_4',
      'guild_boss_season_config_5'
    ])
    expect(result.overlay.sources.at(-1)).toEqual({
      configVersion: result.context.configVersion,
      capturedAt: result.context.capturedAt,
      captureSeason: 110,
      window: [110, 114]
    })
  })

  it('does not advance the capture season during the rollover gap', () => {
    const config = structuredClone(
      FIXTURE_GLOBAL_CONFIG
    ) as typeof FIXTURE_GLOBAL_CONFIG
    const misc = (
      config.guildBoss as {
        misc: {
          firstSeasonStart: number
          seasonDuration: number
          bufferAfterSeasonEnd: number
        }
      }
    ).misc
    const season107Start =
      misc.firstSeasonStart +
      misc.bufferAfterSeasonEnd * 1000 +
      (107 + RUNTIME_SEASON_NUMBER_OFFSET - 1) * misc.seasonDuration * 1000
    const season108Start = season107Start + misc.seasonDuration * 1000

    config.extractedAt = new Date(season108Start - 1).toISOString()

    expect(merger.captureContext(config).captureSeason).toBe(107)
    config.extractedAt = new Date(season108Start).toISOString()
    expect(merger.captureContext(config).captureSeason).toBe(108)
  })

  it('captures S111 loop policy and every normalized encounter field', () => {
    const result = merger.mergeSeasonLineups(
      FIXTURE_GLOBAL_CONFIG,
      EXISTING_OVERLAY
    )
    const season111 = result.overlay.seasons['111']
    const config2 = (
      FIXTURE_GLOBAL_CONFIG.guildBoss as {
        guildBossSeasonDataConfigsGDTO: Record<
          string,
          {
            loopFromTier?: string | number
            loopFromSet?: string | number
            tiers: Array<{ sets: Array<{ encounters: unknown[] }> }>
          }
        >
      }
    ).guildBossSeasonDataConfigsGDTO.guild_boss_season_config_2
    const asNullableInteger = (value: unknown) =>
      value === undefined || value === null || value === ''
        ? null
        : Number(value)
    const expectedEncounterCount = config2?.tiers.reduce(
      (tierTotal, tier) =>
        tierTotal +
        tier.sets.reduce(
          (setTotal, set) => setTotal + set.encounters.length,
          0
        ),
      0
    )

    expect(season111).toMatchObject({
      season: 111,
      configId: 'guild_boss_season_config_2',
      configVersion: 'fixture-config-version',
      loopFromTier: asNullableInteger(config2?.loopFromTier),
      loopFromSet: asNullableInteger(config2?.loopFromSet)
    })
    expect(season111?.loopFromTier).toBe(4)
    expect(expectedEncounterCount).toBeGreaterThan(0)
    expect(season111?.encounters).toHaveLength(expectedEncounterCount)
    for (const encounter of season111?.encounters ?? []) {
      expect(Object.keys(encounter)).toEqual([
        'rarityIndex',
        'set',
        'encounterIndex',
        'encounterType',
        'bossType',
        'unitId',
        'boardId'
      ])
      expect(Object.values(encounter)).not.toContain(undefined)
    }
  })

  it('fails closed instead of reconstructing a missing already-started season', () => {
    const missingCurrent = structuredClone(EXISTING_OVERLAY) as {
      seasons: Record<string, unknown>
    }
    delete missingCurrent.seasons['110']

    expect(() =>
      merger.mergeSeasonLineups(
        FIXTURE_GLOBAL_CONFIG,
        missingCurrent as JsonObject
      )
    ).toThrow('already-started season 110 is missing')
  })

  it('refuses to rewind an overlay with an older GlobalConfig snapshot', () => {
    const newerOverlay = {
      ...structuredClone(EXISTING_OVERLAY),
      generatedAt: new Date(
        Date.parse(FIXTURE_CAPTURED_AT) + 86_400_000
      ).toISOString()
    }

    expect(() =>
      merger.mergeSeasonLineups(FIXTURE_GLOBAL_CONFIG, newerOverlay)
    ).toThrow('GlobalConfig capture is older than the season-lineups overlay')
  })

  it('makes check mode fail on missing next-season coverage without writing', () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'tacticus-season-lineups-')
    )
    temporaryDirectories.push(directory)
    const globalConfigPath = path.join(directory, 'GlobalConfig.json')
    const overlayPath = path.join(directory, 'season-lineups.json')
    const stale = structuredClone(EXISTING_OVERLAY) as {
      seasons: Record<string, unknown>
    }
    delete stale.seasons['112']
    writeFileSync(
      globalConfigPath,
      `${JSON.stringify(FIXTURE_GLOBAL_CONFIG)}\n`
    )
    writeFileSync(overlayPath, `${JSON.stringify(stale, null, 2)}\n`)
    const before = readFileSync(overlayPath, 'utf8')
    const io = { log: vi.fn(), error: vi.fn() }

    expect(
      merger.runCli(
        [
          '--check',
          '--global-config',
          globalConfigPath,
          '--overlay',
          overlayPath
        ],
        io
      )
    ).toBe(1)
    expect(io.error).toHaveBeenCalledWith(
      expect.stringContaining('overlay is stale')
    )
    expect(readFileSync(overlayPath, 'utf8')).toBe(before)

    expect(
      merger.runCli(
        [
          '--dry-run',
          '--global-config',
          globalConfigPath,
          '--overlay',
          overlayPath
        ],
        io
      )
    ).toBe(0)
    expect(readFileSync(overlayPath, 'utf8')).toBe(before)
  })

  it('is idempotent once the same snapshot has been merged', () => {
    const first = merger.mergeSeasonLineups(
      FIXTURE_GLOBAL_CONFIG,
      EXISTING_OVERLAY
    )
    const second = merger.mergeSeasonLineups(
      FIXTURE_GLOBAL_CONFIG,
      first.overlay as unknown as JsonObject
    )

    expect(merger.renderOverlay(second.overlay as unknown as JsonObject)).toBe(
      merger.renderOverlay(first.overlay as unknown as JsonObject)
    )
  })
})
