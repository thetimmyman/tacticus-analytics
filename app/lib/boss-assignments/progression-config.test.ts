import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  getSeasonProgressionConfig: vi.fn(),
  error: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: mocks.serviceDb
}))

vi.mock('@/app/lib/loki/season-configs', () => ({
  getSeasonProgressionConfig: mocks.getSeasonProgressionConfig
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: mocks.error,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}))

import { getActiveProgressionConfig } from './progression-config'
import type { ProgressionConfig } from './progression-config-shared'

const makeQuery = (result: {
  data: unknown
  error: { message: string } | null
}) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue(result)
})

const VALID_CONFIG: ProgressionConfig = {
  firstPassSequence: ['L1', 'L2', 'M1', 'M2'],
  loopSequence: ['M1', 'M2'],
  loopStartStage: 'M1',
  gameVersion: 'test'
}

const VALID_ROW = {
  first_pass_sequence: VALID_CONFIG.firstPassSequence,
  loop_sequence: VALID_CONFIG.loopSequence,
  loop_start_stage: VALID_CONFIG.loopStartStage,
  game_version: VALID_CONFIG.gameVersion
}

describe('getActiveProgressionConfig fail-closed behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSeasonProgressionConfig.mockReturnValue(null)
  })

  it('requires a finite season before touching the database', async () => {
    await expect(
      getActiveProgressionConfig('TEST', Number.NaN)
    ).rejects.toThrow(
      'A finite season number is required to resolve progression config'
    )

    expect(mocks.serviceDb).not.toHaveBeenCalled()
  })

  it('rejects when neither a guild override nor captured season exists', async () => {
    const query = makeQuery({ data: null, error: null })
    mocks.serviceDb.mockReturnValue({ from: vi.fn(() => query) })

    await expect(getActiveProgressionConfig('TEST', 999)).rejects.toThrow(
      'No captured progression config is available for season 999'
    )

    expect(mocks.serviceDb().from).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ season: 999 }),
      'Failed to resolve progression config'
    )
  })

  it('rejects a database query error instead of treating it as no row', async () => {
    const query = makeQuery({
      data: null,
      error: { message: 'connection unavailable' }
    })
    mocks.serviceDb.mockReturnValue({ from: vi.fn(() => query) })

    await expect(getActiveProgressionConfig('TEST', 42)).rejects.toThrow(
      'Failed to load guild progression config: connection unavailable'
    )
  })

  it('returns a valid guild override before consulting the season capture', async () => {
    const query = makeQuery({ data: VALID_ROW, error: null })
    mocks.serviceDb.mockReturnValue({ from: vi.fn(() => query) })

    await expect(getActiveProgressionConfig('TEST', 42)).resolves.toEqual(
      VALID_CONFIG
    )
    expect(mocks.getSeasonProgressionConfig).not.toHaveBeenCalled()
  })

  it('returns and validates the captured season when no guild override exists', async () => {
    mocks.getSeasonProgressionConfig.mockReturnValue(VALID_CONFIG)

    await expect(getActiveProgressionConfig(undefined, 42)).resolves.toEqual(
      VALID_CONFIG
    )
    expect(mocks.serviceDb).not.toHaveBeenCalled()
  })

  it('rejects an uncaptured season without consulting the database for a global row', async () => {
    await expect(getActiveProgressionConfig(undefined, 999)).rejects.toThrow(
      'No captured progression config is available for season 999'
    )

    expect(mocks.serviceDb).not.toHaveBeenCalled()
    expect(mocks.getSeasonProgressionConfig).toHaveBeenCalledWith(999)
  })

  it.each([
    [
      'empty first pass',
      { ...VALID_ROW, first_pass_sequence: [] },
      'firstPassSequence must contain at least one stage'
    ],
    [
      'empty loop',
      { ...VALID_ROW, loop_sequence: [] },
      'loopSequence must contain at least one stage'
    ],
    [
      'blank stage',
      { ...VALID_ROW, first_pass_sequence: ['L1', ' '] },
      'firstPassSequence[1] must be a nonblank trimmed stage code'
    ],
    [
      'duplicate first-pass stage',
      { ...VALID_ROW, first_pass_sequence: ['L1', 'M1', 'M1', 'M2'] },
      'firstPassSequence must not contain duplicate stages'
    ],
    [
      'duplicate loop stage',
      { ...VALID_ROW, loop_sequence: ['M1', 'M1'] },
      'loopSequence must not contain duplicate stages'
    ],
    [
      'inconsistent loop start',
      { ...VALID_ROW, loop_start_stage: 'M2' },
      'loopStartStage must equal the first loopSequence stage'
    ],
    [
      'loop stage outside first pass',
      { ...VALID_ROW, loop_sequence: ['M1', 'M3'] },
      'loop stage M3 is absent from firstPassSequence'
    ]
  ])('rejects a malformed guild override: %s', async (_label, row, detail) => {
    const query = makeQuery({ data: row, error: null })
    mocks.serviceDb.mockReturnValue({ from: vi.fn(() => query) })

    await expect(getActiveProgressionConfig('TEST', 42)).rejects.toThrow(
      `Invalid guild override TEST progression config: ${detail}`
    )
  })

  it('applies the same validation to a captured season config', async () => {
    mocks.getSeasonProgressionConfig.mockReturnValue({
      ...VALID_CONFIG,
      loopStartStage: 'L1'
    })

    await expect(getActiveProgressionConfig(undefined, 42)).rejects.toThrow(
      'Invalid captured season 42 progression config: loopStartStage must equal the first loopSequence stage'
    )
  })
})
