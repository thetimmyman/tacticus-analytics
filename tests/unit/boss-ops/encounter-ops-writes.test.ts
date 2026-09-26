import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MirrorWriteError,
  saveEncounterBehaviour,
  saveEncounterNotes,
  saveEncounterRoles,
  type EncounterRef
} from '@/app/lib/boss-ops/persist-encounter-ops'
import { persistSideSettings } from '@/app/lib/boss-ops/persistence'
import type {
  BossState,
  HeraldBossSummary,
  SideState
} from '@/app/lib/boss-ops/encounter-ops-types'

const PRIME: EncounterRef = {
  guildCode: 'TESTGUILD',
  bossType: 'Magnus',
  rarity: 'Mythic',
  set: 1, // 1-BASED
  encounterId: 1,
  seasonNumber: '103',
  isCurrentSeason: true
}

const STORED_CONFIG = {
  enabled: true,
  webhook_config_ids: ['11111111-1111-1111-1111-111111111111'],
  discord_role_ids: ['111111111111111111', '222222222222222222'],
  discord_role_labels: { '111111111111111111': 'Alpha' },
  extra_links: [{ label: 'Guide', url: 'https://example.test' }],
  extra_videos: [],
  custom_message_url: 'https://discord.com/channels/1/2/3',
  notes: 'stored main note',
  side1_notes: 'stored side1 note',
  side2_notes: 'stored side2 note',
  side1_behaviour: 'threshold',
  side2_behaviour: 'skip',
  side1_threshold_hp_pct: 60,
  side2_threshold_hp_pct: null,
  ping_mode: 'per_side'
}

interface Call {
  url: string
  method: string
  body: Record<string, unknown>
}

let calls: Call[] = []

const okJson = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

function installFetch(overrides: { failUrls?: string[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET') {
        calls.push({
          url,
          method,
          body: JSON.parse(String(init?.body ?? '{}'))
        })
      } else {
        calls.push({ url, method, body: {} })
      }
      if (overrides.failUrls?.some((u) => url.includes(u))) {
        return new Response('nope', { status: 500 })
      }
      if (url.startsWith('/api/herald/boss-config') && method === 'GET') {
        return okJson({ config: STORED_CONFIG })
      }
      return okJson({ ok: true })
    })
  )
}

const writeUrls = () =>
  calls
    .filter((c) => c.method === 'POST' || c.method === 'PUT')
    .map((c) => c.url)

beforeEach(() => {
  calls = []
  installFetch()
})
afterEach(() => vi.unstubAllGlobals())

describe('saveEncounterBehaviour', () => {
  it('writes authoritative stores BEFORE the mirrors (D5)', async () => {
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'threshold',
      thresholdHpPct: 60,
      wasSkipped: true, // skip -> threshold IS a transition, so the mirror fires
      currentTargetTokens: 4
    })

    const urls = writeUrls()
    const skip = urls.findIndex((u) => u.includes('skip-prime'))
    const tokens = urls.findIndex((u) => u.includes('target-tokens'))
    const herald = urls.findIndex((u) => u.includes('herald/boss-config'))

    expect(skip).toBeGreaterThanOrEqual(0)
    // A separate kill-threshold POST would reopen the interleaving window.
    expect(urls.some((u) => u.includes('kill-threshold'))).toBe(false)
    const combined = calls.find((c) => c.url.includes('skip-prime'))!
    expect(combined.body.kill_threshold_pct).toBe(60)
    // Reversed, a crash leaves the authoritative store behind the mirrors undetectably.
    expect(tokens).toBeGreaterThan(skip)
    expect(herald).toBeGreaterThan(skip)
  })

  it('sends the 1-based stage code, not the 0-based one (D11)', async () => {
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'skip',
      wasSkipped: false,
      currentTargetTokens: 2
    })
    const skipCall = calls.find((c) => c.url.includes('skip-prime'))!
    expect(skipCall.body.level).toBe('M1')
    expect(skipCall.body.sub_index).toBe(1)
    expect(skipCall.body.skip).toBe(true)
  })

  it('zeroes the threshold when behaviour is not threshold', async () => {
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'kill',
      thresholdHpPct: 60,
      wasSkipped: true,
      currentTargetTokens: 4
    })
    const thr = calls.find((c) => c.url.includes('skip-prime'))!
    expect(thr.body.kill_threshold_pct).toBe(0)
  })

  it('preserves a real officer target in the skip mirror', async () => {
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'skip',
      wasSkipped: false,
      currentTargetTokens: 7
    })
    const put = calls.find((c) => c.url.includes('target-tokens'))!
    expect(put.body.target_tokens).toBe(7)
    expect(put.body.skip).toBe(true)
  })

  it('writes the deliberate 1 placeholder when the row is unset (D16)', async () => {
    // target_tokens is CHECK (> 0), and TargetsClient treats `<= 1` as "prompt for a target".
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'skip',
      wasSkipped: false,
      currentTargetTokens: 0
    })
    const put = calls.find((c) => c.url.includes('target-tokens'))!
    expect(put.body.target_tokens).toBe(1)
  })

  it('does NOT touch boss_target_tokens when only the rule changes (D16)', async () => {
    // The mirror fires only on a skip transition, or an unset prime loses its provenance.
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'threshold',
      thresholdHpPct: 40,
      wasSkipped: false, // kill -> threshold: skip did not change
      currentTargetTokens: 0
    })
    expect(writeUrls().some((u) => u.includes('target-tokens'))).toBe(false)
    const combined = calls.find((c) => c.url.includes('skip-prime'))!
    expect(combined.body.kill_threshold_pct).toBe(40)
  })

  it('DOES touch boss_target_tokens when skip actually flips', async () => {
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'kill',
      wasSkipped: true,
      currentTargetTokens: 5
    })
    const put = calls.find((c) => c.url.includes('target-tokens'))
    expect(put).toBeDefined()
    expect(put!.body.skip).toBe(false)
  })

  it('suppresses the mirror on an UN-skip with no stored token (WI-4950 F5/C11)', async () => {
    // No row to clear: a PUT would materialise a placeholder and erase provenance.
    await saveEncounterBehaviour(PRIME, {
      behaviour: 'kill',
      wasSkipped: true,
      currentTargetTokens: 0
    })
    expect(writeUrls().some((u) => u.includes('target-tokens'))).toBe(false)
    const combined = calls.find((c) => c.url.includes('skip-prime'))!
    expect(combined.body.skip).toBe(false)
  })

  it('refuses the main boss — it can never be skipped', async () => {
    await expect(
      saveEncounterBehaviour(
        { ...PRIME, encounterId: 0 },
        { behaviour: 'skip', wasSkipped: false, currentTargetTokens: 1 }
      )
    ).rejects.toThrow(/main boss/i)
    expect(writeUrls()).toHaveLength(0)
  })

  it('omits the herald snapshot for a future season', async () => {
    await saveEncounterBehaviour(
      { ...PRIME, isCurrentSeason: false },
      { behaviour: 'skip', wasSkipped: false, currentTargetTokens: 3 }
    )
    expect(writeUrls().some((u) => u.includes('herald/boss-config'))).toBe(
      false
    )
  })

  it('reports which mirror failed instead of claiming the whole write failed', async () => {
    vi.unstubAllGlobals()
    calls = []
    installFetch({ failUrls: ['target-tokens'] })

    const err = await saveEncounterBehaviour(PRIME, {
      behaviour: 'skip',
      wasSkipped: false,
      currentTargetTokens: 2
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MirrorWriteError)
    expect((err as MirrorWriteError).failedMirrors).toEqual(['tokens'])
    expect(writeUrls().some((u) => u.includes('skip-prime'))).toBe(true)
  })
})

describe('herald read-echo (D4)', () => {
  it('GETs before POSTing and round-trips every field it is not changing', async () => {
    await saveEncounterRoles(PRIME, [
      { id: '333333333333333333', label: 'New' }
    ])

    const getIdx = calls.findIndex(
      (c) => c.method === 'GET' && c.url.includes('herald/boss-config')
    )
    const postIdx = calls.findIndex(
      (c) => c.method === 'POST' && c.url.includes('herald/boss-config')
    )
    expect(getIdx).toBeGreaterThanOrEqual(0)
    expect(postIdx).toBeGreaterThan(getIdx)

    const body = calls[postIdx]!.body
    // Defaulting webhook_config_ids to [] silently stops Herald posting.
    expect(body.webhook_config_ids).toEqual(STORED_CONFIG.webhook_config_ids)
    expect(body.enabled).toBe(true)
    expect(body.custom_message_url).toBe(STORED_CONFIG.custom_message_url)
    expect(body.notes).toBe('stored main note')
    expect(body.side1_behaviour).toBe('threshold')
    expect(body.side1_threshold_hp_pct).toBe(60)
    expect(body.ping_mode).toBe('per_side')
    expect(body.discord_role_ids).toEqual([
      { id: '333333333333333333', label: 'New' }
    ])
  })

  it('re-pairs stored role ids with their labels rather than dropping them', async () => {
    // Bare id strings would keep the roles but wipe every label.
    await saveEncounterNotes(PRIME, 'a new note')
    const post = calls.find(
      (c) => c.method === 'POST' && c.url.includes('herald/boss-config')
    )!
    expect(post.body.discord_role_ids).toEqual([
      { id: '111111111111111111', label: 'Alpha' },
      { id: '222222222222222222', label: '' }
    ])
  })
})

describe('saveEncounterNotes (D7)', () => {
  it('writes the per-season store AND the herald fallback', async () => {
    await saveEncounterNotes(PRIME, 'hold for officer ping')

    const seasonCall = calls.find((c) => c.url.includes('notes-mode'))!
    expect(seasonCall.body.side1_notes).toBe('hold for officer ping')
    expect(seasonCall.body.level).toBe('M1')
    expect(seasonCall.body).not.toHaveProperty('side2_notes')
    expect(seasonCall.body).not.toHaveProperty('main_notes')

    const heraldCall = calls.find(
      (c) => c.method === 'POST' && c.url.includes('herald/boss-config')
    )!
    expect(heraldCall.body.side1_notes).toBe('hold for officer ping')
  })

  it('uses the main_notes key for the main boss, not side0', async () => {
    await saveEncounterNotes({ ...PRIME, encounterId: 0 }, 'main note')
    const seasonCall = calls.find((c) => c.url.includes('notes-mode'))!
    expect(seasonCall.body.main_notes).toBe('main note')
  })

  it('clears to NULL, never empty string', async () => {
    // '' reads as unset and would resurrect the stale herald note.
    await saveEncounterNotes(PRIME, '   ')
    const seasonCall = calls.find((c) => c.url.includes('notes-mode'))!
    expect(seasonCall.body.side1_notes).toBeNull()
  })

  it('does not write the herald fallback for a future season', async () => {
    await saveEncounterNotes({ ...PRIME, isCurrentSeason: false }, 'later note')
    expect(calls.some((c) => c.url.includes('notes-mode'))).toBe(true)
    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url.includes('herald/boss-config')
      )
    ).toBe(false)
  })
})

describe('persistSideSettings skip mirror (WI-4950 D6/C11)', () => {
  const HUB_BOSS: HeraldBossSummary = {
    group_key: 'magnus-m1',
    boss_type: 'Magnus',
    boss_name: 'Magnus the Red',
    rarity: 'Mythic',
    set: 0, // 0-BASED in the summary; the mirror ref must send 1
    main: {
      boss_id: 'Magnus_E0',
      boss_name: 'Magnus the Red',
      encounter_id: 0
    },
    sides: [
      { boss_id: 'Magnus_E1', boss_name: 'Abraxas', encounter_id: 1 },
      { boss_id: 'Magnus_E2', boss_name: 'Thaumachus', encounter_id: 2 }
    ]
  }

  const hubSide = (patch: Partial<SideState> = {}): SideState => ({
    role: '',
    behaviour: 'kill',
    threshold: 60,
    notes: '',
    ...patch
  })

  const hubState = (s1: SideState, s2: SideState): BossState => ({
    group_key: HUB_BOSS.group_key,
    expanded: true,
    mainRole: '',
    mainNotes: '',
    pingMode: 'per_side',
    side1: s1,
    side2: s2,
    saveStatus: 'idle',
    dirty: true,
    editVersion: 1
  })

  const HUB_BASELINE = {
    side1Behaviour: 'kill' as const,
    side2Behaviour: 'kill' as const,
    mainNotes: null,
    side1Notes: null,
    side2Notes: null,
    pingMode: 'per_side' as const,
    side1TargetTokens: 7,
    side2TargetTokens: null
  }

  const tokenPuts = () =>
    calls.filter((c) => c.method === 'PUT' && c.url.includes('target-tokens'))

  it('mirrors a hub skip into boss_target_tokens, AFTER the authoritative write, with the real target (C11)', async () => {
    await persistSideSettings(
      HUB_BOSS,
      hubState(hubSide({ behaviour: 'skip' }), hubSide()),
      'TESTGUILD',
      '103',
      HUB_BASELINE
    )
    const urls = writeUrls()
    const skipIdx = urls.findIndex((u) => u.includes('skip-prime'))
    const tokenIdx = urls.findIndex((u) => u.includes('target-tokens'))
    expect(skipIdx).toBeGreaterThanOrEqual(0)
    expect(tokenIdx).toBeGreaterThan(skipIdx)

    const put = tokenPuts()[0]!
    expect(put.body.skip).toBe(true)
    expect(put.body.target_tokens).toBe(7)
    expect(put.body.encounter_id).toBe(1)
    expect(put.body.set).toBe(1) // 1-based, from the 0-based summary set
    expect(put.body.season_number).toBe('103')
  })

  it('sends an explicit skip:false on a hub un-skip (C10)', async () => {
    await persistSideSettings(
      HUB_BOSS,
      hubState(hubSide(), hubSide()),
      'TESTGUILD',
      '103',
      { ...HUB_BASELINE, side1Behaviour: 'skip' }
    )
    const put = tokenPuts()[0]!
    expect(put.body.skip).toBe(false)
    expect(put.body.target_tokens).toBe(7)
  })

  it('falls back to the deliberate 1 placeholder when the row is unset', async () => {
    await persistSideSettings(
      HUB_BOSS,
      hubState(hubSide(), hubSide({ behaviour: 'skip' })),
      'TESTGUILD',
      '103',
      HUB_BASELINE // side2TargetTokens: null
    )
    const put = tokenPuts()[0]!
    expect(put.body.encounter_id).toBe(2)
    expect(put.body.target_tokens).toBe(1)
  })

  it('suppresses the mirror on a hub UN-skip with no stored token (WI-4950 F5/C11)', async () => {
    await persistSideSettings(
      HUB_BOSS,
      hubState(hubSide(), hubSide()),
      'TESTGUILD',
      '103',
      { ...HUB_BASELINE, side1Behaviour: 'skip', side1TargetTokens: null }
    )
    expect(writeUrls().some((u) => u.includes('skip-prime'))).toBe(true)
    expect(tokenPuts()).toEqual([])
  })

  it('does NOT mirror a threshold-only change (skipChanged gating)', async () => {
    await persistSideSettings(
      HUB_BOSS,
      hubState(hubSide({ behaviour: 'threshold', threshold: 40 }), hubSide()),
      'TESTGUILD',
      '103',
      HUB_BASELINE
    )
    expect(writeUrls().some((u) => u.includes('skip-prime'))).toBe(true)
    expect(tokenPuts()).toEqual([])
  })

  it('does NOT mirror a notes-only edit', async () => {
    const state = hubState(hubSide(), hubSide())
    state.mainNotes = 'new note'
    await persistSideSettings(HUB_BOSS, state, 'TESTGUILD', '103', HUB_BASELINE)
    expect(calls.some((c) => c.url.includes('notes-mode'))).toBe(true)
    expect(tokenPuts()).toEqual([])
  })

  it('reports a failed mirror as MirrorWriteError, not a failed save', async () => {
    vi.unstubAllGlobals()
    calls = []
    installFetch({ failUrls: ['target-tokens'] })

    const err = await persistSideSettings(
      HUB_BOSS,
      hubState(hubSide({ behaviour: 'skip' }), hubSide()),
      'TESTGUILD',
      '103',
      HUB_BASELINE
    ).catch((e) => e)

    expect(err).toBeInstanceOf(MirrorWriteError)
    expect((err as MirrorWriteError).failedMirrors).toEqual(['tokens'])
    expect(writeUrls().some((u) => u.includes('skip-prime'))).toBe(true)
  })
})
