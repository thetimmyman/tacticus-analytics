import { describe, expect, it } from 'vitest'
import playbooks from '@/data/boss-playbooks/playbooks.json'
import seasonLineups from '@/data/loki-api/season-lineups.json'
import globalConfig from '@/data/loki-api/GlobalConfig.json'
import { getSeasonPosition } from '@/app/lib/loki/season-configs'
import {
  buildExternalNormalizationContext,
  buildExternalPublishTags,
  extractTerminusReplayLibrary,
  extractYouTubeVideoId,
  inferSeasonNumber,
  isPublishReadyCandidate,
  lineupBossEncounter,
  normalizeTerminusReplay,
  parseReplayTitleHeuristics,
  tierToLineupCoordinates
} from '@/app/lib/guild-ops/replay-external-sources'
import {
  resolveHeroNickname,
  resolveMachineOfWarNickname
} from '@/app/lib/catalogs/hero-nicknames'

const ctx = buildExternalNormalizationContext({
  playbooks,
  seasonLineups,
  globalConfig
})

const SZAREKH_SAMPLE = {
  id: 'https://www.youtube.com/watch?v=pS0D8UQ_kv4-959',
  boss: 'Szarekh',
  bossLongName: 'Szarekh the Silent King',
  team: 'Laviscus',
  map: 'Szarekh_03',
  tier: 'M2',
  damage: 2940000,
  heroes: ['Lav', 'Kari', 'Traj', 'Boss', 'Aesoth'],
  mow: 'Biovore',
  creator: 'Mawg',
  videoUrl: 'https://www.youtube.com/watch?v=pS0D8UQ_kv4',
  publishedAt: '6/30/2026 4:39 AM',
  publishedAtTimestamp: 1782794340000
}

describe('extractTerminusReplayLibrary', () => {
  it('extracts the inline JSON blob through nested braces and strings', () => {
    const payload = {
      replays: [{ boss: 'Szarekh', note: 'brace } in { string' }],
      teams: ['Laviscus']
    }
    const html = `<html><script>(function(){const replayLibraryData = ${JSON.stringify(
      payload
    )};window.x={}})()</script></html>`
    const library = extractTerminusReplayLibrary(html)
    expect(library.replays).toHaveLength(1)
    expect(library.teams).toEqual(['Laviscus'])
  })

  it('throws when the marker is missing or the object never balances', () => {
    expect(() => extractTerminusReplayLibrary('<html></html>')).toThrow(
      /marker not found/
    )
    expect(() =>
      extractTerminusReplayLibrary('const replayLibraryData = {"replays": [')
    ).toThrow(/never balanced/)
  })
})

describe('normalization context (anti-drift cross-checks)', () => {
  // inferSeasonNumber and getSeasonPosition must agree even inside the inter-season gap.
  const GAP_BOUNDARY = {
    lastSecondOfSeason: Date.parse('2026-09-08T09:59:59.000Z'),
    firstSecondOfGap: Date.parse('2026-09-08T10:00:00.000Z'),
    midGap: Date.parse('2026-09-08T22:00:00.000Z'),
    firstSecondOfNextSeason: Date.parse('2026-09-09T10:00:00.000Z'),
    midNextSeason: Date.parse('2026-09-16T10:00:00.000Z')
  }

  it('season window math matches getSeasonPosition (SEASON_NUMBER_OFFSET drift gate)', () => {
    for (const [label, reference] of Object.entries(GAP_BOUNDARY)) {
      expect(inferSeasonNumber(reference, ctx.seasonWindow), label).toBe(
        getSeasonPosition(reference).seasonNumber
      )
    }
    for (const reference of [
      SZAREKH_SAMPLE.publishedAtTimestamp,
      Date.parse('2026-04-22T12:00:00Z')
    ]) {
      expect(inferSeasonNumber(reference, ctx.seasonWindow)).toBe(
        getSeasonPosition(reference).seasonNumber
      )
    }
    // Real time may land inside the gap, so this is logged, not asserted.
    // eslint-disable-next-line no-console
    console.log(
      'inferSeasonNumber(Date.now())=',
      inferSeasonNumber(Date.now(), ctx.seasonWindow),
      'getSeasonPosition(Date.now()).seasonNumber=',
      getSeasonPosition(Date.now()).seasonNumber
    )
  })
})

describe('tier -> lineup coordinates', () => {
  it('maps L1-L5 to Legendary sets and M1-M5 to Mythic sets', () => {
    expect(tierToLineupCoordinates('L4')).toEqual({ set: 3, rarityIndex: 4 })
    expect(tierToLineupCoordinates('M2')).toEqual({ set: 1, rarityIndex: 5 })
    expect(tierToLineupCoordinates('l1')).toEqual({ set: 0, rarityIndex: 4 })
    expect(tierToLineupCoordinates('M3')).toEqual({ set: 2, rarityIndex: 5 })
    expect(tierToLineupCoordinates('E3')).toBeNull()
  })

  it('pins the season-104 encounters the production archive shows', () => {
    expect(lineupBossEncounter(ctx, 104, 'L4')).toMatchObject({
      bossType: 'Ghazghkull',
      boardId: 'GB_Dakka_04'
    })
    expect(lineupBossEncounter(ctx, 104, 'M2')).toMatchObject({
      bossType: 'Ghazghkull',
      boardId: 'GB_Dakka_05'
    })
    expect(lineupBossEncounter(ctx, 104, 'M1')).toMatchObject({
      bossType: 'BelisariusRW',
      boardId: 'GB_Belisarius_03'
    })
  })
})

describe('normalizeTerminusReplay', () => {
  it('fully normalizes the real Szarekh M2 sample with zero parse flags', () => {
    const candidate = normalizeTerminusReplay(SZAREKH_SAMPLE, ctx)
    expect(candidate.parseFlags.missing).toEqual([])
    expect(candidate).toMatchObject({
      sourceSystem: 'terminus-maximus',
      externalVideoId: 'pS0D8UQ_kv4',
      bossId: 'silent-king',
      boardId: 'GB_SK_03',
      tier: 'M2',
      damage: 2940000,
      metaTeamName: 'Lavstodes',
      creator: 'Mawg',
      encounterRole: 'boss'
    })
    expect(candidate.units).toEqual([
      'Laviscus',
      'Kariyan',
      'Trajann',
      'Boss Gulgortz',
      'Aesoth',
      'Biovore'
    ])
    // Rollover-week publish: drift correction must settle on the season whose M2 is SilentKing.
    expect(candidate.season).toBeTruthy()
    const encounter = lineupBossEncounter(ctx, Number(candidate.season), 'M2')
    expect(encounter?.bossType).toBe('SilentKing')
    expect(isPublishReadyCandidate(candidate)).toBe(true)
  })

  it('still refuses a candidate with no resolvable boss — that is unpublishable, not reviewable', () => {
    // boss_id is NOT NULL and upstream sends a bare "Tervigon", so the gate holds this back.
    const candidate = normalizeTerminusReplay(
      {
        ...SZAREKH_SAMPLE,
        boss: 'Tervigon',
        bossLongName: 'Tervigon',
        map: 'Tervigon_04'
      },
      ctx
    )
    expect(candidate.bossId).toBeNull()
    expect(candidate.parseFlags.missing).toContain('boss-variant')
    expect(isPublishReadyCandidate(candidate)).toBe(false)
  })

  it('flags unknown hero and MoW vocabulary instead of passing it through silently', () => {
    const candidate = normalizeTerminusReplay(
      {
        ...SZAREKH_SAMPLE,
        heroes: ['Lav', 'BrandNewHero'],
        mow: 'MysteryEngine'
      },
      ctx
    )
    expect(candidate.parseFlags.missing).toContain('hero:BrandNewHero')
    expect(candidate.parseFlags.missing).toContain('mow:MysteryEngine')
    // A vocabulary gap is provenance only; it does not park the replay in review.
    expect(isPublishReadyCandidate(candidate)).toBe(true)
    expect(candidate.units).toContain('BrandNewHero')
    expect(candidate.units).toContain('MysteryEngine')
  })

  it('flags tyranid records whose season cannot pin a single variant', () => {
    // Season 104 runs several Tervigon variants, none at L/M: genuinely ambiguous.
    const publishedInSeason104 = Date.parse('2026-07-07T00:00:00Z') // mid-season at time of writing
    const candidate = normalizeTerminusReplay(
      {
        ...SZAREKH_SAMPLE,
        boss: 'Tervigon',
        map: 'Tervigon_04',
        tier: 'L2',
        publishedAt: undefined,
        publishedAtTimestamp: publishedInSeason104
      },
      ctx
    )
    if (candidate.bossId === null) {
      expect(candidate.parseFlags.missing).toContain('boss-variant')
    } else {
      expect(candidate.bossId).toMatch(/^tervigon-/)
    }
  })

  it('flags bad tiers, damage, and unmappable maps', () => {
    const candidate = normalizeTerminusReplay(
      {
        ...SZAREKH_SAMPLE,
        tier: 'X9',
        damage: 0,
        map: 'Szarekh_99'
      },
      ctx
    )
    expect(candidate.parseFlags.missing).toContain('tier')
    expect(candidate.parseFlags.missing).toContain('damage')
    expect(candidate.parseFlags.missing).toContain('board')
    expect(isPublishReadyCandidate(candidate)).toBe(true)
  })
})

describe('hero + MoW nicknames', () => {
  it('resolves the community shorthand to prod hero_mappings display names', () => {
    expect(resolveHeroNickname('Traj')).toBe('Trajann')
    expect(resolveHeroNickname('Helb')).toBe('High Marshal Helbrecht')
    expect(resolveHeroNickname('Rho')).toBe('Exitor-Rho-1.15/x')
    expect(resolveHeroNickname('Tan')).toBe("Tan Gi'da")
    expect(resolveHeroNickname('Aunshi')).toBe("Aun'shi")
    expect(resolveHeroNickname('Dante')).toBe('Dante')
    expect(resolveMachineOfWarNickname('FF')).toBe('Forgefiend')
    expect(resolveMachineOfWarNickname('PBC')).toBe('Plagueburst Crawler')
    expect(resolveMachineOfWarNickname('Zkar')).toBe("Z'Kar")
    expect(resolveMachineOfWarNickname('Exo')).toBe('Exorcist')
  })
})

describe('extractYouTubeVideoId', () => {
  // The ingest dedupes by extracted id, so every URL shape is a dedupe contract.
  it('extracts video ids from watch/short-link/shorts/embed URL shapes', () => {
    expect(
      extractYouTubeVideoId('https://www.youtube.com/watch?v=pS0D8UQ_kv4')
    ).toBe('pS0D8UQ_kv4')
    expect(extractYouTubeVideoId('https://youtu.be/pS0D8UQ_kv4')).toBe(
      'pS0D8UQ_kv4'
    )
    expect(
      extractYouTubeVideoId('https://www.youtube.com/shorts/pS0D8UQ_kv4')
    ).toBe('pS0D8UQ_kv4')
    expect(
      extractYouTubeVideoId('https://www.youtube.com/embed/pS0D8UQ_kv4')
    ).toBe('pS0D8UQ_kv4')
  })

  it('returns null for a non-YouTube URL and for empty input', () => {
    expect(extractYouTubeVideoId('https://example.com/clip')).toBeNull()
    expect(extractYouTubeVideoId(null)).toBeNull()
    expect(extractYouTubeVideoId(undefined)).toBeNull()
  })
})

describe('parseReplayTitleHeuristics', () => {
  it('extracts tier/damage/boss/map/team from free-form titles', () => {
    expect(
      parseReplayTitleHeuristics('SZAREKH M2 2.94M Lavstodes full clear Map 03')
    ).toEqual({
      tier: 'M2',
      damage: 2940000,
      bossWord: 'Szarekh',
      mapNumber: '03',
      metaTeamName: 'Lavstodes'
    })
    expect(
      parseReplayTitleHeuristics('Ghazghkull L4 1,875,927 damage — Custodes')
    ).toMatchObject({
      tier: 'L4',
      damage: 1875927,
      bossWord: 'Ghaz',
      metaTeamName: 'Custodes'
    })
    expect(parseReplayTitleHeuristics('roster review episode 12')).toEqual({
      tier: null,
      damage: null,
      bossWord: null,
      mapNumber: null,
      metaTeamName: null
    })
  })
})

describe('publish tags', () => {
  it('mirrors the queue approve tag shape', () => {
    expect(buildExternalPublishTags('terminus-maximus', 'boss')).toEqual([
      'terminus-maximus',
      'boss',
      'encounter:boss'
    ])
  })
})
