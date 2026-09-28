import { describe, it, expect, vi } from 'vitest'
import { markPlayersNotInGuildAsInactive as appDeactivate } from '@/app/lib/sync/db-operations'
import { markPlayersNotInGuildAsInactive as edgeDeactivate } from '@/supabase/functions/_shared/sync-modules/db-mappings.ts'

/** The edge (Deno) and app copies must deactivate the identical set for identical input. */

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function mockSupabase(currentRows: Array<{ player_id: string }>) {
  const deactivated: string[][] = []
  const selectChain = {
    eq() {
      return this
    },
    or() {
      return Promise.resolve({ data: currentRows, error: null })
    }
  }
  const client = {
    from: vi.fn(() => ({
      select: () => selectChain
    })),
    rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
      const ids = args.p_player_ids as string[]
      deactivated.push(ids)
      return Promise.resolve({
        data: {
          success: true,
          guild_code: args.p_guild_code,
          requested_count: ids.length,
          deactivated_count: ids.length,
          observation_stale: false,
          deactivated_mapping_ids: ids.map((_, index) => index + 1),
          revoked_attestations: 0,
          purged_loki_credential_count: 0,
          purged_loki_guild_codes: [],
          authority_cleared: true
        },
        error: null
      })
    })
  }
  return { client, deactivated }
}

async function runBoth(
  rows: string[],
  currentMemberIds: Set<string>,
  recentlyActiveIds: Set<string>
) {
  const currentRows = rows.map((player_id) => ({ player_id }))

  const appMock = mockSupabase(currentRows)
  await appDeactivate(
    appMock.client as never,
    'GUILD',
    currentMemberIds,
    recentlyActiveIds
  )

  const edgeMock = mockSupabase(currentRows)
  await edgeDeactivate(
    { supabase: edgeMock.client, logger: noopLogger } as never,
    { playerMappingTable: 'player_mapping' },
    'GUILD',
    currentMemberIds,
    'loki',
    recentlyActiveIds,
    null
  )

  const app = (appMock.deactivated[0] ?? []).slice().sort()
  const edge = (edgeMock.deactivated[0] ?? []).slice().sort()
  return { app, edge }
}

describe('markPlayersNotInGuildAsInactive edge<->app parity (drift guard)', () => {
  it('deactivates the same set: present-in-roster + recently-active are spared', async () => {
    const { app, edge } = await runBoth(
      ['A', 'B', 'C'],
      new Set(['A']),
      new Set(['B'])
    )
    expect(app).toEqual(['C'])
    expect(edge).toEqual(app)
  })

  it('both deactivate nothing when every absent member is spared by recent activity', async () => {
    const { app, edge } = await runBoth(
      ['A', 'B'],
      new Set(['A']),
      new Set(['B'])
    )
    expect(app).toEqual([])
    expect(edge).toEqual(app)
  })

  it('both fire the all-members circuit breaker (>5 candidates == active count -> skip)', async () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F']
    const { app, edge } = await runBoth(rows, new Set(['X']), new Set())
    expect(app).toEqual([])
    expect(edge).toEqual(app)
  })
})
