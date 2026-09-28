import { describe, expect, it } from 'vitest'
import { transformGuildSnapshot } from '@/app/(public)/explore/utils'
import {
  filterGuildsByPrivacy,
  formatDamageWithPrivacy
} from '@tacticus/app-core/explore-privacy'
import type { GuildSnapshot } from '@tacticus/app-core/database-extensions'
import type { GuildData } from '@/app/(public)/explore/types'

/** /explore renders what the old browser-side redaction did, except hide_players also redacts champions. */

const HITS_RAW = [
  {
    boss: 'Szarekh',
    damage: 110000,
    player: 'Alice',
    encounterId: 0,
    rarity: 'Legendary',
    set: 1
  },
  {
    boss: 'Prime1',
    damage: 50000,
    player: 'Bob',
    encounterId: 1,
    rarity: 'Epic',
    set: 1
  },
  {
    boss: 'Prime2',
    damage: 40000,
    player: 'Cara',
    encounterId: 2,
    rarity: 'Epic',
    set: 1
  }
]

const CHAMPIONS_RAW = [
  { season: '83', player: 'Alice', points: 0 },
  { season: '82', player: 'Bob', points: 0 }
]

const CHAMPIONS_REDACTED = [
  { season: '83', player: 'Anonymous Warrior', points: 0 },
  { season: '82', player: 'Anonymous Warrior', points: 0 }
]

const snapshot = (
  modes: string[],
  hits: unknown[],
  overrides: Partial<GuildSnapshot> = {},
  champions: unknown[] = CHAMPIONS_RAW
): GuildSnapshot =>
  ({
    guild_code: 'ABC',
    guild_name: 'Alpha',
    guild_tag: null,
    cluster_code: null,
    cluster_name: null,
    season: 84,
    rank: 1,
    war_rank: null,
    total_damage: 3010000,
    average_damage: 301000,
    total_battles: 10,
    active_players: 5,
    avg_damage_per_battle: 301000,
    member_count: 5,
    veteran_count: 2,
    votlw_count: 0,
    top_boss_hits: hits,
    votlw_champions: champions,
    last_updated: '2026-09-04T00:00:00Z',
    explore_privacy_mode: modes,
    explore_obfuscation_percent: 10,
    ...overrides
  }) as unknown as GuildSnapshot

const render = (rows: GuildSnapshot[]): GuildData[] =>
  filterGuildsByPrivacy(rows.map(transformGuildSnapshot)) as GuildData[]

const rendered = (guilds: GuildData[]) =>
  guilds.map((g) => ({
    guild_code: g.guild_code,
    total_damage: g.total_damage,
    avg_damage_per_battle: g.avg_damage_per_battle,
    isObfuscated: g.isObfuscated,
    champions: g.votlw_champions.map((c) => ({
      season: c.season,
      player: c.player
    })),
    hits: g.top_boss_hits.map((h) => ({
      boss: h.boss,
      player: h.player,
      damage: h.damage,
      encounterId: h.encounterId
    }))
  }))

describe('explore mapping over the server-redacted shape', () => {
  it('["public"] is byte-identical either way', () => {
    const modes = ['public']
    expect(rendered(render([snapshot(modes, HITS_RAW)]))).toEqual(
      rendered(render([snapshot(modes, HITS_RAW)]))
    )
    expect(render([snapshot(modes, HITS_RAW)])[0].top_boss_hits[0].player).toBe(
      'Alice'
    )
  })

  it('hide_players renders identically from the redacted shape', () => {
    const modes = ['hide_players']
    const redactedHits = HITS_RAW.map((h) => ({
      ...h,
      player: 'Anonymous Warrior'
    }))

    expect(
      rendered(render([snapshot(modes, redactedHits, {}, CHAMPIONS_REDACTED)]))
    ).toEqual(rendered(render([snapshot(modes, HITS_RAW)])))
    expect(
      render([snapshot(modes, redactedHits)])[0].top_boss_hits.map(
        (h) => h.player
      )
    ).toEqual(['Anonymous Warrior', 'Anonymous Warrior', 'Anonymous Warrior'])
  })

  it('hide_players anonymizes votlw_champions -- a deliberate behaviour change', () => {
    const fromRaw = render([snapshot(['hide_players'], HITS_RAW)])[0]
    expect(fromRaw.votlw_champions.map((c) => c.player)).toEqual([
      'Anonymous Warrior',
      'Anonymous Warrior'
    ])
    expect(fromRaw.votlw_champions.map((c) => c.season)).toEqual(['83', '82'])

    const publicGuild = render([snapshot(['public'], HITS_RAW)])[0]
    expect(publicGuild.votlw_champions.map((c) => c.player)).toEqual([
      'Alice',
      'Bob'
    ])
  })

  it('hide_primes renders identically from the redacted shape', () => {
    const modes = ['hide_primes']
    const redactedHits = HITS_RAW.filter((h) => h.encounterId === 0)

    expect(rendered(render([snapshot(modes, redactedHits)]))).toEqual(
      rendered(render([snapshot(modes, HITS_RAW)]))
    )
    expect(
      render([snapshot(modes, redactedHits)])[0].top_boss_hits
    ).toHaveLength(1)
  })

  it('obfuscate_values renders identically from the redacted shape', () => {
    const modes = ['obfuscate_values']
    const redactedHits = [
      {
        ...HITS_RAW[0],
        damage: 100000,
        originalDamage: 110000,
        isObfuscated: true,
        obfuscationPercent: 10
      },
      {
        ...HITS_RAW[1],
        damage: 50000,
        originalDamage: 50000,
        isObfuscated: true,
        obfuscationPercent: 10
      },
      {
        ...HITS_RAW[2],
        damage: 50000,
        originalDamage: 40000,
        isObfuscated: true,
        obfuscationPercent: 10
      }
    ]
    const redacted = snapshot(modes, redactedHits, {
      total_damage: 3000000,
      average_damage: 300000,
      avg_damage_per_battle: 300000
    } as Partial<GuildSnapshot>)

    // The browser must not round again, or it stacks on the view's jitter.
    const guild = render([redacted])[0]
    expect(guild.total_damage).toBe(3000000)
    expect(guild.avg_damage_per_battle).toBe(300000)
    expect(guild.isObfuscated).toBe(true)
    expect(guild.obfuscationPercent).toBe(10)
    expect(guild.top_boss_hits.map((h) => h.damage)).toEqual([
      100000, 50000, 50000
    ])

    // Raw passes through: anon/authenticated cannot SELECT the base table, so the view is the only source.
    const fromRaw = render([snapshot(modes, HITS_RAW)])[0]
    expect(fromRaw.total_damage).not.toBe(guild.total_damage)
  })

  it('hide_players + obfuscate_values renders identically from the redacted shape', () => {
    const modes = ['hide_players', 'obfuscate_values']
    const redactedHits = [
      {
        ...HITS_RAW[0],
        player: 'Anonymous Warrior',
        damage: 100000,
        originalDamage: 110000,
        isObfuscated: true,
        obfuscationPercent: 10
      },
      {
        ...HITS_RAW[1],
        player: 'Anonymous Warrior',
        damage: 50000,
        originalDamage: 50000,
        isObfuscated: true,
        obfuscationPercent: 10
      },
      {
        ...HITS_RAW[2],
        player: 'Anonymous Warrior',
        damage: 50000,
        originalDamage: 40000,
        isObfuscated: true,
        obfuscationPercent: 10
      }
    ]
    const redacted = snapshot(
      modes,
      redactedHits,
      {
        total_damage: 3000000,
        average_damage: 300000,
        avg_damage_per_battle: 300000
      } as Partial<GuildSnapshot>,
      CHAMPIONS_REDACTED
    )

    const guild = render([redacted])[0]
    expect(guild.total_damage).toBe(3000000)
    expect(guild.avg_damage_per_battle).toBe(300000)
    expect(
      guild.top_boss_hits.every((h) => h.player === 'Anonymous Warrior')
    ).toBe(true)
    expect(guild.top_boss_hits.map((h) => h.damage)).toEqual([
      100000, 50000, 50000
    ])
    expect(rendered(render([redacted]))).toEqual(rendered(render([redacted])))
  })

  it('hide_all: the view withholds the row, and the page shows the same nothing', () => {
    expect(render([])).toEqual([])
    expect(render([snapshot(['hide_all'], HITS_RAW)])).toEqual([])
  })

  it('originalTotalDamage is the SERVED total, never the truth', () => {
    // originalTotalDamage equals the served total, so no true number reaches the client.
    const fromRedacted = render([
      snapshot(['obfuscate_values'], HITS_RAW, {
        total_damage: 3000000
      } as Partial<GuildSnapshot>)
    ])[0]

    expect(fromRedacted.originalTotalDamage).toBe(fromRedacted.total_damage)
    expect(fromRedacted.originalTotalDamage).toBe(3000000)
    expect(
      fromRedacted.top_boss_hits.every((h) => h.originalDamage === h.damage)
    ).toBe(true)

    expect(
      formatDamageWithPrivacy(
        fromRedacted.total_damage,
        'obfuscate_values',
        fromRedacted.originalTotalDamage,
        10
      )
    ).toBe(formatDamageWithPrivacy(3000000, 'obfuscate_values', 3000000, 10))
  })
})
