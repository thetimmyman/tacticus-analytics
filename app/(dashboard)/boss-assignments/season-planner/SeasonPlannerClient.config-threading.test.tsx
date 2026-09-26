import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  configure
} from '@testing-library/react'
import SeasonPlannerClient from '@/app/(dashboard)/boss-assignments/season-planner/SeasonPlannerClient'
import type { SeasonConfigInfo } from '@/app/(dashboard)/boss-playbooks/types'

// Multi-step async flows; the default 1000ms waitFor is too tight under parallel CI.
configure({ asyncUtilTimeout: 5000 })

// A non-live season forecasts its own rotation: generatePlan sends `config_id` when
// initialConfigId differs from liveConfigId (LIVE, not the snapshot-detected config).

const CONFIG_TARGET = 'config_target'
const CONFIG_LIVE = 'config_live'
const ALLY_GUILD_CODE = '00000000-0000-4000-8000-000000000006'

const allSeasons: SeasonConfigInfo[] = [
  { id: CONFIG_LIVE, index: 1, canonicals: [] },
  { id: CONFIG_TARGET, index: 2, canonicals: [] }
]

const minimalSnapshot = {
  snapshotAt: '2026-07-01T00:00:00.000Z',
  guildCode: 'TEST',
  season: '140',
  seasonId: CONFIG_TARGET,
  stageCode: 'L1',
  loopIndex: 0,
  advancedStage: false,
  encounters: {
    main: {
      encounterId: 0,
      targetUid: 'm',
      targetLabel: 'L1 Main',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'boss',
      maxHp: 100,
      remainingHp: 100,
      seededFromMax: false,
      confidence: 'high'
    },
    prime1: {
      encounterId: 1,
      targetUid: 'p1',
      targetLabel: 'L1 Prime 1',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'p1',
      maxHp: 0,
      remainingHp: 0,
      seededFromMax: true,
      confidence: 'low'
    },
    prime2: {
      encounterId: 2,
      targetUid: 'p2',
      targetLabel: 'L1 Prime 2',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'p2',
      maxHp: 0,
      remainingHp: 0,
      seededFromMax: true,
      confidence: 'low'
    }
  },
  warnings: []
}

const minimalPlanPayload = {
  season: '140',
  season_id: CONFIG_TARGET,
  season_start_at: '2026-07-01T00:00:00.000Z',
  season_end_at: '2026-07-14T00:00:00.000Z',
  snapshot_at: '2026-07-01T00:00:00.000Z',
  time_zone: 'UTC',
  lookback_days: 30,
  sessions_per_day: 1,
  snapshot: minimalSnapshot,
  plan: {
    sessions: [],
    finalRaidState: minimalSnapshot,
    metrics: {
      tokensSpent: 0,
      overkillDamage: 0,
      bossesDefeated: 0,
      loopAdvances: 0,
      wastedTokens: 0,
      wastedTicks: 0
    },
    warnings: []
  },
  remainingBossSequence: [],
  tokens_remaining_spendable: 0
}

const makeRosterStrategyPayload = (
  hasSwap: boolean,
  options: { includeIncoming?: boolean } = {}
) => ({
  clusterCode: 'cluster-a',
  targetGuildCode: 'TEST',
  guilds: [
    {
      guildCode: 'TEST',
      displayName: 'Test Guild',
      clusterCode: 'cluster-a',
      timeZone: 'UTC'
    },
    {
      guildCode: ALLY_GUILD_CODE,
      displayName: 'Ally Guild',
      clusterCode: 'cluster-a',
      timeZone: 'UTC'
    }
  ],
  members: [
    {
      playerId: 'p1',
      displayName: 'Target One',
      guildCode: 'TEST',
      role: 'officer'
    }
  ].concat(
    options.includeIncoming === false
      ? []
      : [
          {
            playerId: 'p2',
            displayName: 'Incoming Two',
            guildCode: ALLY_GUILD_CODE,
            role: 'member'
          },
          {
            playerId: 'p3',
            displayName: 'Incoming Three',
            guildCode: ALLY_GUILD_CODE,
            role: 'member'
          }
        ]
  ),
  seasons: [{ season: '140', configId: CONFIG_TARGET, label: 'S140' }],
  baseline: {
    guildCode: 'TEST',
    aggregate: {
      guildCode: 'TEST',
      memberCount: 1,
      tokensSpent: 1,
      tokensHeld: 0,
      wastedTokens: 0,
      bossesDefeated: 1,
      loopAdvances: 0,
      appliedDamage: 1000,
      expectedDamage: 1200,
      overkillDamage: 0,
      tokenEfficiency: 1000,
      finalStageCode: 'L1',
      finalLoopIndex: 0,
      tokensRemainingSpendable: 0
    },
    seasons: [],
    contributions: []
  },
  swap: hasSwap
    ? {
        outgoing: {
          playerId: 'p1',
          displayName: 'Target One',
          guildCode: 'TEST',
          role: 'officer'
        },
        incoming: {
          playerId: 'p2',
          displayName: 'Incoming Two',
          guildCode: ALLY_GUILD_CODE,
          role: 'member'
        },
        targetGuildBefore: {
          guildCode: 'TEST',
          aggregate: {},
          seasons: [],
          contributions: []
        },
        targetGuildAfter: {
          guildCode: 'TEST',
          aggregate: {},
          seasons: [],
          contributions: []
        },
        targetGuildDelta: {
          tokensSpent: 0,
          wastedTokens: 0,
          bossesDefeated: 1,
          loopAdvances: 0,
          appliedDamage: 100,
          expectedDamage: 100,
          overkillDamage: 0,
          tokenEfficiency: 100,
          score: 200
        },
        partnerGuildBefore: {
          guildCode: ALLY_GUILD_CODE,
          aggregate: {},
          seasons: [],
          contributions: []
        },
        partnerGuildAfter: {
          guildCode: ALLY_GUILD_CODE,
          aggregate: {},
          seasons: [],
          contributions: []
        },
        partnerGuildDelta: {
          tokensSpent: 0,
          wastedTokens: 0,
          bossesDefeated: 0,
          loopAdvances: 0,
          appliedDamage: -100,
          expectedDamage: -100,
          overkillDamage: 0,
          tokenEfficiency: -100,
          score: -100
        },
        combinedDelta: {
          tokensSpent: 0,
          wastedTokens: 0,
          bossesDefeated: 1,
          loopAdvances: 0,
          appliedDamage: 0,
          expectedDamage: 0,
          overkillDamage: 0,
          tokenEfficiency: 0,
          score: 100
        }
      }
    : null,
  optimizer: [],
  investments: [],
  warnings: []
})

function jsonRes(data: unknown) {
  return { ok: true, status: 200, json: async () => data }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/season-plan/snapshot')) {
      return jsonRes({
        snapshot: minimalSnapshot,
        roster: [],
        detectedConfigId: CONFIG_LIVE
      })
    }
    if (u.includes('/season-plan/generate')) {
      return jsonRes(minimalPlanPayload)
    }
    if (u.includes('/season-plan?season_id=')) {
      return jsonRes({ plans: [] })
    }
    if (u.includes('/season-plan/roster-strategy')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
    }
    return jsonRes({})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const generateUrls = () =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/season-plan/generate'))

const snapshotUrls = () =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/season-plan/snapshot'))

const rosterStrategyBodies = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/season-plan/roster-strategy'))
    .map((c) => JSON.parse(String(c[1]?.body ?? '{}')))

// Retry quarantines a CI-only timing flake; remove once de-flaked.
describe(
  'SeasonPlannerClient — config_id threading',
  { retry: process.env.CI ? 2 : 0 },
  () => {
    it('sends config_id for a non-live season (target config != live config)', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())

      fireEvent.click(screen.getByText('Generate Plan'))

      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))
      const url = generateUrls()[0]
      expect(url).toContain(`config_id=${CONFIG_TARGET}`)
      expect(url).not.toContain(`config_id=${CONFIG_LIVE}`)
    })

    it('does NOT send config_id when the target config equals the live config', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_LIVE}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      fireEvent.click(screen.getByText('Generate Plan'))

      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))
      expect(generateUrls()[0]).not.toContain('config_id=')
    })

    it('keeps an explicit Boss Rotation selection when an older detected snapshot resolves', async () => {
      const deferredInitialSnapshot: { resolve?: () => void } = {}
      let snapshotCount = 0
      fetchMock.mockImplementation(async (url: string | URL) => {
        const u = String(url)
        if (u.includes('/season-plan/snapshot')) {
          snapshotCount += 1
          if (snapshotCount === 1) {
            return new Promise((resolve) => {
              deferredInitialSnapshot.resolve = () =>
                resolve(
                  jsonRes({
                    snapshot: {
                      ...minimalSnapshot,
                      seasonId: CONFIG_LIVE
                    },
                    roster: [],
                    detectedConfigId: CONFIG_LIVE
                  })
                )
            })
          }
          return jsonRes({
            snapshot: {
              ...minimalSnapshot,
              seasonId: CONFIG_TARGET
            },
            roster: [],
            detectedConfigId: CONFIG_LIVE
          })
        }
        if (u.includes('/season-plan/generate')) {
          return jsonRes(minimalPlanPayload)
        }
        if (u.includes('/season-plan?season_id=')) {
          return jsonRes({ plans: [] })
        }
        return jsonRes({})
      })

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(snapshotUrls().length).toBe(1))
      fireEvent.change(screen.getByLabelText(/boss rotation/i), {
        target: { value: CONFIG_TARGET }
      })
      await waitFor(() =>
        expect(
          snapshotUrls().some((url) =>
            url.includes(`config_id=${CONFIG_TARGET}`)
          )
        ).toBe(true)
      )

      if (!deferredInitialSnapshot.resolve) {
        throw new Error('Expected initial snapshot response to be pending')
      }
      deferredInitialSnapshot.resolve()

      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))
      expect(generateUrls()[0]).toContain(`config_id=${CONFIG_TARGET}`)
    })

    it('selects the mapped rotation when a standalone planner season is typed', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          liveConfigId={CONFIG_LIVE}
          seasonConfigResolutions={[
            { seasonNumber: 140, configId: CONFIG_LIVE },
            { seasonNumber: 141, configId: CONFIG_TARGET }
          ]}
        />
      )

      await waitFor(() => expect(snapshotUrls().length).toBeGreaterThan(0))
      fireEvent.change(screen.getByLabelText(/season \(optional\)/i), {
        target: { value: '141' }
      })

      await waitFor(() =>
        expect(
          snapshotUrls().some(
            (url) =>
              url.includes('season=141') &&
              url.includes(`config_id=${CONFIG_TARGET}`)
          )
        ).toBe(true)
      )

      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))
      expect(generateUrls().at(-1)).toContain(`config_id=${CONFIG_TARGET}`)
    })

    it('threads generated snapshot_at into roster strategy requests', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )

      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))

      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      expect(rosterStrategyBodies()[0]).toEqual(
        expect.objectContaining({
          snapshot_at: minimalPlanPayload.snapshot_at
        })
      )
    })

    it('threads the visible snapshot_at into roster strategy requests before a plan exists', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      // Load Roster is disabled until snapshot?.seasonId exists, so wait for it.
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))

      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      expect(rosterStrategyBodies()[0]).toEqual(
        expect.objectContaining({
          snapshot_at: minimalSnapshot.snapshotAt
        })
      )
    })

    it('does not run roster strategy against a stale snapshot while a new snapshot is pending', async () => {
      const deferredSecondSnapshot: { resolve?: () => void } = {}
      const refreshedSnapshot = {
        ...minimalSnapshot,
        snapshotAt: '2026-07-02T00:00:00.000Z',
        season: '141'
      }
      let snapshotCount = 0
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            snapshotCount += 1
            if (snapshotCount === 1) {
              return jsonRes({
                snapshot: minimalSnapshot,
                roster: [],
                detectedConfigId: CONFIG_LIVE
              })
            }
            return new Promise((resolve) => {
              deferredSecondSnapshot.resolve = () =>
                resolve(
                  jsonRes({
                    snapshot: refreshedSnapshot,
                    roster: [],
                    detectedConfigId: CONFIG_LIVE
                  })
                )
            })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [] })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(snapshotUrls().length).toBe(1))
      fireEvent.change(screen.getByLabelText(/season \(optional\)/i), {
        target: { value: '141' }
      })
      await waitFor(() => expect(snapshotUrls().length).toBe(2))

      const loadButton = screen.getByRole('button', { name: /load roster/i })
      await waitFor(() =>
        expect((loadButton as HTMLButtonElement).disabled).toBe(true)
      )
      fireEvent.click(loadButton)
      expect(rosterStrategyBodies()).toHaveLength(0)

      const resolveSecondSnapshot = deferredSecondSnapshot.resolve
      if (!resolveSecondSnapshot) {
        throw new Error('Expected second snapshot response to be pending')
      }
      resolveSecondSnapshot()
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      expect(rosterStrategyBodies()[0]).toEqual(
        expect.objectContaining({
          season: '141',
          snapshot_at: refreshedSnapshot.snapshotAt
        })
      )
    })

    it('keeps an in-flight snapshot refresh alive when non-snapshot controls change', async () => {
      const deferredSnapshot: { resolve?: () => void } = {}
      const refreshedSnapshot = {
        ...minimalSnapshot,
        snapshotAt: '2026-07-03T00:00:00.000Z'
      }
      let snapshotCount = 0
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            snapshotCount += 1
            if (snapshotCount === 1) {
              return jsonRes({
                snapshot: minimalSnapshot,
                roster: [],
                detectedConfigId: CONFIG_LIVE
              })
            }
            return new Promise((resolve) => {
              deferredSnapshot.resolve = () =>
                resolve(
                  jsonRes({
                    snapshot: refreshedSnapshot,
                    roster: [],
                    detectedConfigId: CONFIG_LIVE
                  })
                )
            })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [] })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(snapshotUrls().length).toBe(1))
      // Wait for the snapshot to commit: while loading the button reads "Refreshing…".
      await waitFor(() =>
        expect(
          screen.getByTestId('snapshot-panel').getAttribute('data-snapshot-at')
        ).toBe(minimalSnapshot.snapshotAt)
      )
      fireEvent.click(screen.getByRole('button', { name: /refresh snapshot/i }))
      await waitFor(() => expect(snapshotUrls().length).toBe(2))
      fireEvent.change(screen.getByLabelText(/lookback days/i), {
        target: { value: '45' }
      })

      if (!deferredSnapshot.resolve) {
        throw new Error('Expected refreshed snapshot response to be pending')
      }
      deferredSnapshot.resolve()

      // "Load roster" is already enabled; wait for the committed refresh or snapshotAt is stale.
      await waitFor(() =>
        expect(
          screen.getByTestId('snapshot-panel').getAttribute('data-snapshot-at')
        ).toBe(refreshedSnapshot.snapshotAt)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      expect(rosterStrategyBodies()[0]).toEqual(
        expect.objectContaining({
          snapshot_at: refreshedSnapshot.snapshotAt
        })
      )
    })

    it('clears stale swap results when either selected member changes', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      // Wait for Load Roster to enable; waitFor(fetchMock) only proves the fetch started.
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(screen.getByLabelText(/current guild member/i)).toBeTruthy()
      )

      // Wait for the defaulting effect to enable the button, or the click no-ops.
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /simulate swap/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /simulate swap/i }))

      await waitFor(() => expect(screen.getByText('Combined')).toBeTruthy())

      fireEvent.change(screen.getByLabelText(/incoming cluster member/i), {
        target: { value: 'p2' }
      })

      expect(
        screen.getByText(/select two members and simulate the swap/i)
      ).toBeTruthy()
      expect(screen.queryByText('Combined')).toBeNull()
    })

    it('does not submit a stale swap after the roster strategy season window changes', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(screen.getByLabelText(/incoming cluster member/i)).toBeTruthy()
      )

      fireEvent.change(screen.getByLabelText(/^seasons$/i), {
        target: { value: '2' }
      })
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))

      await waitFor(() => expect(rosterStrategyBodies().length).toBe(2))
      expect(rosterStrategyBodies()[0]).not.toHaveProperty('swap')
      expect(rosterStrategyBodies()[1]).toEqual(
        expect.objectContaining({ season_count: 2 })
      )
      expect(rosterStrategyBodies()[1]).not.toHaveProperty('swap')
    })

    it('does not fabricate a default swap before member selectors are visible', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))

      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      expect(rosterStrategyBodies()[0]).not.toHaveProperty('swap')
      await waitFor(() => {
        expect(screen.getByLabelText(/current guild member/i)).toBeTruthy()
        expect(screen.getByLabelText(/incoming cluster member/i)).toBeTruthy()
        expect(screen.queryByText('Combined')).toBeNull()
      })
    })

    it('sorts incoming members and shows friendly guild labels instead of raw guild ids', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(screen.getByLabelText(/incoming cluster member/i)).toBeTruthy()
      )

      const guildSelect = screen.getByLabelText(
        /incoming guild/i
      ) as HTMLSelectElement
      expect(
        Array.from(guildSelect.options).map((option) => option.text)
      ).toEqual(['All cluster guilds · 2 members', 'Ally Guild · 2 members'])

      const incomingSelect = screen.getByLabelText(
        /incoming cluster member/i
      ) as HTMLSelectElement
      expect(
        Array.from(incomingSelect.options).map((option) => option.text)
      ).toEqual(['Incoming Three · Ally Guild', 'Incoming Two · Ally Guild'])
      expect(
        Array.from(incomingSelect.options)
          .map((option) => option.text)
          .join(' ')
      ).not.toContain(ALLY_GUILD_CODE)
    })

    it('invalidates generated plan output when planning controls change', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))

      const saveButton = screen.getByRole('button', {
        name: /save plan/i
      }) as HTMLButtonElement
      await waitFor(() => expect(saveButton.disabled).toBe(false))

      fireEvent.change(screen.getByLabelText(/lookback days/i), {
        target: { value: '45' }
      })

      await waitFor(() => {
        expect(saveButton.disabled).toBe(true)
        expect(
          screen.getByText(
            /generate a plan or load a saved plan to view output/i
          )
        ).toBeTruthy()
      })
    })

    it('ignores stale in-flight generated plans after controls change', async () => {
      const deferredGenerate: { resolve?: () => void } = {}
      let staleResponseRead = false
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan/generate')) {
            return new Promise((resolve) => {
              deferredGenerate.resolve = () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => {
                    staleResponseRead = true
                    return minimalPlanPayload
                  }
                })
            })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [] })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))

      fireEvent.change(screen.getByLabelText(/lookback days/i), {
        target: { value: '45' }
      })
      if (!deferredGenerate.resolve) {
        throw new Error('Expected deferred generate response to be pending')
      }
      deferredGenerate.resolve()

      await waitFor(() => expect(staleResponseRead).toBe(true))
      const saveButton = screen.getByRole('button', {
        name: /save plan/i
      }) as HTMLButtonElement
      expect(saveButton.disabled).toBe(true)
      expect(
        screen.getByText(/generate a plan or load a saved plan to view output/i)
      ).toBeTruthy()
    })

    it('clears roster strategy output after generating a new plan', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(screen.getByText('Baseline projection')).toBeTruthy()
      )

      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))

      await waitFor(() =>
        expect(screen.queryByText('Baseline projection')).toBeNull()
      )
      expect(
        screen.getByText(/load the roster to review same-cluster members/i)
      ).toBeTruthy()
    })

    it('clears generated plan and roster strategy output when refreshing the snapshot', async () => {
      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )

      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      await waitFor(() =>
        expect(screen.getByText('Baseline projection')).toBeTruthy()
      )

      const snapshotRequestsBeforeRefresh = snapshotUrls().length
      fireEvent.click(screen.getByRole('button', { name: /refresh snapshot/i }))

      expect(screen.queryByText('Baseline projection')).toBeNull()
      await waitFor(() => {
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(true)
        expect(
          screen.getByText(
            /generate a plan or load a saved plan to view output/i
          )
        ).toBeTruthy()
      })
      await waitFor(() =>
        expect(snapshotUrls().length).toBeGreaterThan(
          snapshotRequestsBeforeRefresh
        )
      )
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /refresh snapshot/i })
        ).toBeTruthy()
      )
    })

    it('shows a disabled swap state when no incoming cluster members exist', async () => {
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan/generate')) {
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [] })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(
              makeRosterStrategyPayload(Boolean(body.swap), {
                includeIncoming: false
              })
            )
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))

      await waitFor(() =>
        expect(
          screen.getByText(/no incoming same-cluster members are available/i)
        ).toBeTruthy()
      )
      const simulateButton = screen.getByRole('button', {
        name: /simulate swap/i
      }) as HTMLButtonElement
      expect(simulateButton.disabled).toBe(true)
      expect(screen.getByLabelText(/incoming cluster member/i)).toHaveProperty(
        'disabled',
        true
      )
    })

    it('clears stale plan and strategy output while a new plan is generating', async () => {
      const deferredGenerate: { resolve?: () => void } = {}
      let generateCount = 0
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan/generate')) {
            generateCount += 1
            if (generateCount === 2) {
              return new Promise((resolve) => {
                deferredGenerate.resolve = () =>
                  resolve(jsonRes(minimalPlanPayload))
              })
            }
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [] })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBe(1))
      // Wait on applied state; the response may not be processed when the request fires.
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )

      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBe(2))

      // Same race in reverse: wait for the visible result.
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(true)
      )
      expect(
        screen.getByText(/generate a plan or load a saved plan to view output/i)
      ).toBeTruthy()

      if (!deferredGenerate.resolve) {
        throw new Error('Expected second generate response to be pending')
      }
      deferredGenerate.resolve()
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
    })

    it('threads a loaded saved plan snapshot into roster strategy requests', async () => {
      const savedSnapshotAt = '2026-07-03T00:00:00.000Z'
      const savedPlan = {
        id: 'saved-1',
        season_id: CONFIG_TARGET,
        start_at: minimalPlanPayload.season_start_at,
        end_at: minimalPlanPayload.season_end_at,
        snapshot_at: savedSnapshotAt,
        kind: 'replan',
        trigger: 'ui_generate',
        created_at: '2026-07-03T01:00:00.000Z',
        plan: {
          ...minimalPlanPayload,
          snapshot_at: savedSnapshotAt
        }
      }
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan?id=saved-1')) {
            return jsonRes({ plan: savedPlan })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [savedPlan] })
          }
          if (u.includes('/season-plan/generate')) {
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Load$/ })).toBeTruthy()
      )
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /save plan/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )

      fireEvent.click(screen.getByRole('button', { name: /^Load$/ }))
      await waitFor(() => expect(screen.getByText('Loaded')).toBeTruthy())
      expect(
        (
          screen.getByRole('button', {
            name: /save plan/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )

      expect(rosterStrategyBodies()[0]).toEqual(
        expect.objectContaining({
          snapshot_at: savedSnapshotAt
        })
      )
    })

    it('ignores pending generated plan responses after loading a saved plan', async () => {
      const savedSnapshotAt = '2026-07-04T00:00:00.000Z'
      const deferredGenerate: { resolve?: () => void } = {}
      let staleResponseRead = false
      const savedPlan = {
        id: 'saved-2',
        season_id: CONFIG_TARGET,
        start_at: minimalPlanPayload.season_start_at,
        end_at: minimalPlanPayload.season_end_at,
        snapshot_at: savedSnapshotAt,
        kind: 'replan',
        trigger: 'ui_generate',
        created_at: '2026-07-04T01:00:00.000Z',
        plan: {
          ...minimalPlanPayload,
          snapshot_at: savedSnapshotAt
        }
      }
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan?id=saved-2')) {
            return jsonRes({ plan: savedPlan })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [savedPlan] })
          }
          if (u.includes('/season-plan/generate')) {
            return new Promise((resolve) => {
              deferredGenerate.resolve = () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => {
                    staleResponseRead = true
                    return minimalPlanPayload
                  }
                })
            })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Load$/ })).toBeTruthy()
      )
      fireEvent.click(screen.getByText('Generate Plan'))
      await waitFor(() => expect(generateUrls().length).toBeGreaterThan(0))

      fireEvent.click(screen.getByRole('button', { name: /^Load$/ }))
      await waitFor(() => expect(screen.getByText('Loaded')).toBeTruthy())

      if (!deferredGenerate.resolve) {
        throw new Error('Expected generate response to be pending')
      }
      deferredGenerate.resolve()
      await waitFor(() => expect(staleResponseRead).toBe(true))
      expect(
        (
          screen.getByRole('button', {
            name: /save plan/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(rosterStrategyBodies().length).toBeGreaterThan(0)
      )
      expect(rosterStrategyBodies()[0]).toEqual(
        expect.objectContaining({
          snapshot_at: savedSnapshotAt
        })
      )
    })

    it('does not mark saved plans loaded or enable strategy actions while saved payload is pending', async () => {
      const savedSnapshotAt = '2026-07-05T00:00:00.000Z'
      const deferredSavedPlan: { resolve?: () => void } = {}
      const savedPlan = {
        id: 'saved-3',
        season_id: CONFIG_TARGET,
        start_at: minimalPlanPayload.season_start_at,
        end_at: minimalPlanPayload.season_end_at,
        snapshot_at: savedSnapshotAt,
        kind: 'replan',
        trigger: 'ui_generate',
        created_at: '2026-07-05T01:00:00.000Z',
        plan: {
          ...minimalPlanPayload,
          snapshot_at: savedSnapshotAt
        }
      }
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan?id=saved-3')) {
            return new Promise((resolve) => {
              deferredSavedPlan.resolve = () =>
                resolve(jsonRes({ plan: savedPlan }))
            })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [savedPlan] })
          }
          if (u.includes('/season-plan/generate')) {
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Load$/ })).toBeTruthy()
      )
      fireEvent.click(screen.getByRole('button', { name: /^Load$/ }))

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /loading/i })).toBeTruthy()
      )
      expect(screen.queryByText('Loaded')).toBeNull()
      expect(
        (
          screen.getByRole('button', {
            name: /load roster/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)
      expect(
        (
          screen.getByRole('button', {
            name: /generate plan/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)
      expect(
        (
          screen.getByRole('button', {
            name: /optimize roster/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)

      if (!deferredSavedPlan.resolve) {
        throw new Error('Expected saved plan response to be pending')
      }
      deferredSavedPlan.resolve()
      await waitFor(() => expect(screen.getByText('Loaded')).toBeTruthy())
      expect(
        (
          screen.getByRole('button', {
            name: /load roster/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
      expect(
        (
          screen.getByRole('button', {
            name: /generate plan/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    })

    it('ignores pending saved-plan payloads after controls change', async () => {
      const savedSnapshotAt = '2026-07-06T00:00:00.000Z'
      const deferredSavedPlan: { resolve?: () => void } = {}
      let staleResponseRead = false
      const savedPlan = {
        id: 'saved-4',
        season_id: CONFIG_TARGET,
        start_at: minimalPlanPayload.season_start_at,
        end_at: minimalPlanPayload.season_end_at,
        snapshot_at: savedSnapshotAt,
        kind: 'replan',
        trigger: 'ui_generate',
        created_at: '2026-07-06T01:00:00.000Z',
        plan: {
          ...minimalPlanPayload,
          snapshot_at: savedSnapshotAt
        }
      }
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan?id=saved-4')) {
            return new Promise((resolve) => {
              deferredSavedPlan.resolve = () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => {
                    staleResponseRead = true
                    return { plan: savedPlan }
                  }
                })
            })
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [savedPlan] })
          }
          if (u.includes('/season-plan/generate')) {
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Load$/ })).toBeTruthy()
      )
      fireEvent.click(screen.getByRole('button', { name: /^Load$/ }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /loading/i })).toBeTruthy()
      )

      fireEvent.change(screen.getByLabelText(/lookback days/i), {
        target: { value: '45' }
      })

      if (!deferredSavedPlan.resolve) {
        throw new Error('Expected saved plan response to be pending')
      }
      deferredSavedPlan.resolve()
      await waitFor(() => expect(staleResponseRead).toBe(true))

      expect(screen.queryByText('Loaded')).toBeNull()
      expect(
        (
          screen.getByRole('button', {
            name: /save plan/i
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)
      expect(
        screen.getByText(/generate a plan or load a saved plan to view output/i)
      ).toBeTruthy()
    })

    it('ignores pending swap simulation responses after member selection changes', async () => {
      const deferredSwap: { resolve?: () => void } = {}
      let staleSwapRead = false
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            return jsonRes({
              snapshot: minimalSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan/generate')) {
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({ plans: [] })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            if (body.swap) {
              return new Promise((resolve) => {
                deferredSwap.resolve = () =>
                  resolve({
                    ok: true,
                    status: 200,
                    json: async () => {
                      staleSwapRead = true
                      return makeRosterStrategyPayload(true)
                    }
                  })
              })
            }
            return jsonRes(makeRosterStrategyPayload(false))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /load roster/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /load roster/i }))
      await waitFor(() =>
        expect(screen.getByLabelText(/incoming cluster member/i)).toBeTruthy()
      )

      // Swap selectors default one flush after render; until then clicks no-op.
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: /simulate swap/i
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      )
      fireEvent.click(screen.getByRole('button', { name: /simulate swap/i }))
      await waitFor(() => {
        if (!deferredSwap.resolve) {
          throw new Error('Expected swap response to be pending')
        }
      })
      fireEvent.change(screen.getByLabelText(/incoming cluster member/i), {
        target: { value: 'p2' }
      })

      const resolveSwap = deferredSwap.resolve
      if (!resolveSwap) {
        throw new Error('Expected swap response to remain pending')
      }
      resolveSwap()
      await waitFor(() => expect(staleSwapRead).toBe(true))
      expect(screen.queryByText('Combined')).toBeNull()
      expect(
        screen.getByText(/select two members and simulate the swap/i)
      ).toBeTruthy()
    })

    it('ignores stale snapshot and saved-plan-list responses after season changes', async () => {
      const deferredFirstSnapshot: { resolve?: () => void } = {}
      const lateSnapshot = {
        ...minimalSnapshot,
        season: '140',
        seasonId: CONFIG_TARGET
      }
      const currentSnapshot = {
        ...minimalSnapshot,
        season: '141',
        seasonId: CONFIG_LIVE
      }
      const stalePlan = {
        id: 'stale-plan',
        season_id: CONFIG_TARGET,
        start_at: minimalPlanPayload.season_start_at,
        end_at: minimalPlanPayload.season_end_at,
        snapshot_at: minimalPlanPayload.snapshot_at,
        kind: 'replan',
        trigger: 'ui_generate',
        created_at: '2026-07-01T01:00:00.000Z',
        plan: minimalPlanPayload
      }
      let snapshotCount = 0
      fetchMock.mockImplementation(
        async (url: string | URL, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/season-plan/snapshot')) {
            snapshotCount += 1
            if (snapshotCount === 1) {
              return new Promise((resolve) => {
                deferredFirstSnapshot.resolve = () =>
                  resolve(
                    jsonRes({
                      snapshot: lateSnapshot,
                      roster: [],
                      detectedConfigId: CONFIG_TARGET
                    })
                  )
              })
            }
            return jsonRes({
              snapshot: currentSnapshot,
              roster: [],
              detectedConfigId: CONFIG_LIVE
            })
          }
          if (u.includes('/season-plan/generate')) {
            return jsonRes(minimalPlanPayload)
          }
          if (u.includes('/season-plan?season_id=')) {
            return jsonRes({
              plans: u.includes(CONFIG_TARGET) ? [stalePlan] : []
            })
          }
          if (u.includes('/season-plan/roster-strategy')) {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            return jsonRes(makeRosterStrategyPayload(Boolean(body.swap)))
          }
          return jsonRes({})
        }
      )

      render(
        <SeasonPlannerClient
          canEdit
          currentSeasonIndex={1}
          allSeasons={allSeasons}
          initialSeason="140"
          initialConfigId={CONFIG_TARGET}
          liveConfigId={CONFIG_LIVE}
        />
      )

      fireEvent.change(screen.getByLabelText(/season \(optional\)/i), {
        target: { value: '141' }
      })
      await waitFor(() => expect(screen.getByDisplayValue('141')).toBeTruthy())

      if (!deferredFirstSnapshot.resolve) {
        throw new Error('Expected initial snapshot response to be pending')
      }
      deferredFirstSnapshot.resolve()

      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some((call) => String(call[0]).includes('141'))
        ).toBe(true)
      )
      expect(screen.getByDisplayValue('141')).toBeTruthy()
      const savedPlanUrls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/season-plan?season_id='))
      expect(savedPlanUrls.some((url) => url.includes(CONFIG_TARGET))).toBe(
        false
      )
    })
  }
)
