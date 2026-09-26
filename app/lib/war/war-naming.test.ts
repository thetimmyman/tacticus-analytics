import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KNOWN_BOARD_IDS,
  KNOWN_ZONE_TYPES,
  boardDisplayName,
  hasBoardName,
  humanizeUnknownZoneType,
  zoneDisplayName,
  zoneGameName,
  zoneShortName,
  zoneVisualId
} from './war-naming'
// Generated plain const map with no Deno imports, so safe to import here.
import { ZONE_DISPLAY_NAMES as EDGE_ZONE_DISPLAY_NAMES } from '@/supabase/functions/_shared/guild-war-zone-names.generated'

const ROOT = join(__dirname, '../../..')

// Observed in production; GlobalConfig alone omits `WarpRift` and `unknown`.
const PROD_OBSERVED_ZONE_TYPES = [
  'AntiAirBattery',
  'AntiAirBattery1',
  'AntiAirBattery2',
  'Armoury',
  'ArtilleryPosition1',
  'ArtilleryPosition2',
  'Bunker1',
  'Bunker2',
  'ComsStation',
  'HQ',
  'LandingPad1',
  'LandingPad2',
  'MedicaeStation1',
  'MedicaeStation2',
  'SupplyDepot',
  'Trenches1',
  'Trenches2',
  'Trenches3',
  'WarpRift',
  'unknown'
] as const

describe('war-naming — coverage (positive controls)', () => {
  it('covers a real population, not an empty table', () => {
    expect(KNOWN_ZONE_TYPES.length).toBeGreaterThanOrEqual(20)
    expect(KNOWN_BOARD_IDS.length).toBeGreaterThanOrEqual(15)
  })

  it('covers every zone type observed in production', () => {
    const missing = PROD_OBSERVED_ZONE_TYPES.filter(
      (z) => !KNOWN_ZONE_TYPES.includes(z)
    )
    expect(missing, `uncovered prod zone types: ${missing.join(', ')}`).toEqual(
      []
    )
  })

  it('covers every zone type in the CURRENT GlobalConfig', () => {
    const gc = JSON.parse(
      readFileSync(join(ROOT, 'data/loki-api/GlobalConfig.json'), 'utf8')
    ) as {
      guildWar: {
        guildWarSeasonConfigs: Record<
          string,
          { zoneTypeConfigs?: Record<string, unknown> }
        >
      }
    }
    const configured = new Set<string>()
    for (const cfg of Object.values(gc.guildWar.guildWarSeasonConfigs)) {
      for (const zoneType of Object.keys(cfg.zoneTypeConfigs ?? {})) {
        configured.add(zoneType)
      }
    }
    expect(configured.size).toBeGreaterThan(0)
    const missing = [...configured].filter((z) => !KNOWN_ZONE_TYPES.includes(z))
    expect(
      missing,
      `GlobalConfig zone types missing from the canonical table: ${missing.join(', ')}`
    ).toEqual([])
  })

  // Ids that are already English words; any other name equal to its id is a leaked raw id.
  const ID_IS_ALSO_A_REAL_WORD = new Set(['Armoury'])

  it('NEVER renders a raw internal identifier for a known zone type', () => {
    for (const zoneType of KNOWN_ZONE_TYPES) {
      const name = zoneDisplayName(zoneType)
      expect(
        name,
        `${zoneType} renders a camelCase identifier: ${name}`
      ).not.toMatch(/[a-z][A-Z]/)
      expect(
        name,
        `${zoneType} renders a glued numeric suffix: ${name}`
      ).not.toMatch(/[A-Za-z]\d/)
      if (!ID_IS_ALSO_A_REAL_WORD.has(zoneType)) {
        expect(name, `${zoneType} renders its raw id`).not.toBe(zoneType)
      }
    }
  })

  it('the real-word allowlist stays honest (no silent growth)', () => {
    for (const zoneType of ID_IS_ALSO_A_REAL_WORD) {
      expect(KNOWN_ZONE_TYPES).toContain(zoneType)
      expect(zoneDisplayName(zoneType)).toBe(zoneGameName(zoneType))
    }
    expect(ID_IS_ALSO_A_REAL_WORD.size).toBeLessThanOrEqual(2)
  })
})

describe('war-naming — the game is the source of truth', () => {
  // The retired hand-authored tables got these families wrong.
  it.each([
    ['Trenches1', 'Left Frontline', 'Frontline'],
    ['Trenches2', 'Mid Frontline', 'Frontline'],
    ['Trenches3', 'Right Frontline', 'Frontline'],
    ['HQ', 'Headquarters', 'Headquarters'],
    ['Bunker1', 'Fortified Position 1', 'Fortified Position'],
    ['Bunker2', 'Fortified Position 2', 'Fortified Position'],
    ['ComsStation', 'Vox-Station', 'Vox-Station']
  ])('%s renders %s (game name: %s)', (zoneType, expected, gameName) => {
    expect(zoneDisplayName(zoneType)).toBe(expected)
    expect(zoneGameName(zoneType)).toBe(gameName)
  })

  it('does NOT use the retired invented names', () => {
    const retired = [
      'Trenches Alpha',
      'Trenches Beta',
      'Trenches Gamma',
      'Command HQ',
      'Fortified Bunker',
      'Comms Station'
    ]
    const rendered = KNOWN_ZONE_TYPES.map(zoneDisplayName)
    for (const name of retired) {
      expect(
        rendered,
        `retired invented name resurfaced: ${name}`
      ).not.toContain(name)
    }
  })

  it('the ids absent from the CURRENT GlobalConfig are still named', () => {
    expect(zoneDisplayName('unknown')).toBe('Unclear Signal')
    expect(zoneDisplayName('WarpRift')).toBe('Warp Rift')
    // Rotated-out barracks pair (visualId `barracks`, game name "Troop Garrison").
    expect(zoneDisplayName('Garrison1')).toBe('Troop Garrison 1')
    expect(zoneDisplayName('Garrison2')).toBe('Troop Garrison 2')
    expect(zoneGameName('Garrison1')).toBe('Troop Garrison')
    expect(zoneVisualId('Garrison1')).toBe('barracks')
    expect(zoneShortName('Garrison1')).toBe('Garrison 1')
    expect(zoneShortName('Garrison2')).toBe('Garrison 2')
  })

  // No zone id maps to the minefield string; a guessed id would be worse than the humanize fallback.
  it('has no minefield zone type (no id maps to it — searched 2026-08-11)', () => {
    const minefieldIds = KNOWN_ZONE_TYPES.filter(
      (z) => zoneVisualId(z) === 'minefield'
    )
    expect(minefieldIds).toEqual([])
  })
})

describe('war-naming — app/edge zone-name lockstep', () => {
  const EDGE_KEYS = Object.keys(EDGE_ZONE_DISPLAY_NAMES).sort()

  it('the edge table is populated (positive control)', () => {
    expect(EDGE_KEYS.length).toBeGreaterThanOrEqual(20)
  })

  it('covers exactly the same zone type ids as the canonical config', () => {
    expect(EDGE_KEYS).toEqual([...KNOWN_ZONE_TYPES])
  })

  it('renders byte-identical names to the app on every known zone type', () => {
    for (const zoneType of KNOWN_ZONE_TYPES) {
      expect(
        EDGE_ZONE_DISPLAY_NAMES[zoneType],
        `edge/app zone-name drift on ${zoneType}`
      ).toBe(zoneDisplayName(zoneType))
    }
  })

  it('does not carry the retired invented names', () => {
    const values = Object.values(EDGE_ZONE_DISPLAY_NAMES)
    for (const retired of [
      'Trenches Alpha',
      'Trenches Beta',
      'Trenches Gamma',
      'Command HQ',
      'Fortified Bunker',
      'Garrison Alpha',
      'Garrison Beta'
    ]) {
      expect(
        values,
        `retired invented name resurfaced on the edge side: ${retired}`
      ).not.toContain(retired)
    }
  })

  it('is still a generated artifact, not a re-hand-authored table', () => {
    const source = readFileSync(
      join(
        ROOT,
        'supabase/functions/_shared/guild-war-zone-names.generated.ts'
      ),
      'utf8'
    )
    expect(source).toContain('GENERATED FILE - DO NOT HAND-EDIT')
    expect(source).toContain('scripts/datamine/build-guild-war-zone-names.mjs')
  })
})

describe('war-naming — degenerate inputs', () => {
  it('null/undefined/empty render a stable label, never a crash', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(zoneDisplayName(input)).toBe('Unknown Zone')
      expect(zoneShortName(input)).toBe('Unknown Zone')
      expect(zoneGameName(input)).toBe('Unknown Zone')
    }
    expect(zoneVisualId(null)).toBe(null)
  })

  it('trims incidental whitespace rather than missing the lookup', () => {
    expect(zoneDisplayName('  Bunker2  ')).toBe('Fortified Position 2')
  })

  it('an UNKNOWN id is humanized, never shown raw', () => {
    expect(zoneDisplayName('AntiAirBattery3')).toBe('Anti Air Battery 3')
    expect(humanizeUnknownZoneType('SomeNewZone2')).toBe('Some New Zone 2')
  })
})

describe('war-naming — boards', () => {
  it('renders community board names', () => {
    expect(boardDisplayName('LHE_Desert_02')).toBe('Gulch')
    expect(boardDisplayName('C1_37')).toBe('Three Bridges')
    expect(boardDisplayName('C1_23')).toBe("Sniper's Nest")
    expect(hasBoardName('LHE_Desert_02')).toBe(true)
  })

  it('falls back to the board id when the community has no name', () => {
    // Unlike zones, the community refers to unnamed boards by their id.
    expect(boardDisplayName('PVP_desert_06')).toBe('PVP_desert_06')
    expect(hasBoardName('PVP_desert_06')).toBe(false)
    expect(boardDisplayName(null)).toBe('Unknown Board')
  })

  it('covers every board in every season map pool', () => {
    const index = JSON.parse(
      readFileSync(
        join(ROOT, 'public/images/game-assets/guild-war/index.json'),
        'utf8'
      )
    ) as {
      seasons: Record<string, { mapPool: { boardId: string }[] }>
    }
    const pooled = new Set<string>()
    for (const season of Object.values(index.seasons)) {
      for (const entry of season.mapPool) pooled.add(entry.boardId)
    }
    expect(pooled.size).toBeGreaterThan(0)
    const missing = [...pooled].filter((b) => !hasBoardName(b))
    expect(
      missing,
      `pooled boards with no community name: ${missing.join(', ')}`
    ).toEqual([])
  })
})
