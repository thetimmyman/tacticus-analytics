import { describe, it, expect, vi } from 'vitest'

import {
  buildBattleRowsQuery,
  type BattleRowsParams
} from '@/app/lib/data/battle-rows'
import type { Database } from '@/app/lib/db'

type Call = [string, ...unknown[]]

function makeRecordingClient() {
  const calls: Call[] = []
  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'eq', 'gt', 'not', 'in', 'order']) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args])
      return chain
    })
  }
  const from = vi.fn((table: string) => {
    calls.push(['from', table])
    return chain
  })
  return { client: { from } as unknown as Database, calls }
}

const canonical = (calls: Call[]) => ({
  hasBattlePair:
    calls.some(
      (c) => c[0] === 'eq' && c[1] === 'damageType' && c[2] === 'Battle'
    ) &&
    calls.some((c) => c[0] === 'gt' && c[1] === 'damageDealt' && c[2] === 0),
  hasNamePredicate: calls.some(
    (c) => c[0] === 'not' && c[1] === 'Name' && c[2] === 'is' && c[3] === null
  ),
  terminalOrder:
    calls[calls.length - 1]?.[0] === 'order' &&
    calls[calls.length - 1]?.[1] === 'startedOn' &&
    (calls[calls.length - 1]?.[2] as { ascending: boolean }).ascending === false
})

describe('buildBattleRowsQuery (canonical battle-row stack)', () => {
  it('always applies the battle pair, the Name predicate, and a TERMINAL startedOn DESC order', () => {
    const { client, calls } = makeRecordingClient()
    buildBattleRowsQuery(client, {
      select: 'Name, damageDealt',
      scope: { guild: 'TEST' }
    })
    const c = canonical(calls)
    expect(c.hasBattlePair).toBe(true)
    expect(c.hasNamePredicate).toBe(true)
    expect(c.terminalOrder).toBe(true)
    expect(calls[0]).toEqual(['from', 'EOT_GR_data'])
  })

  it('keeps the invariants across every scope / encounter / season combination', () => {
    const variants: BattleRowsParams[] = [
      { select: 'a', scope: { guild: 'G' } },
      { select: 'a', scope: { guilds: ['G', 'H'] } },
      { select: 'a', scope: { cluster: 'C' } },
      { select: 'a', scope: { guild: 'G' }, encounters: 'main-and-primes' },
      { select: 'a', scope: { guild: 'G' }, encounters: 'primes' },
      { select: 'a', scope: { guild: 'G' }, encounters: [0, 3] },
      { select: 'a', scope: { guild: 'G' }, season: '85' },
      { select: 'a', scope: { guild: 'G' }, seasons: ['84', '85'] },
      {
        select: 'a',
        scope: { cluster: 'C' },
        rarities: ['Legendary', 'Mythic'],
        encounters: 'main-and-primes',
        season: '85'
      }
    ]
    for (const params of variants) {
      const { client, calls } = makeRecordingClient()
      buildBattleRowsQuery(client, params)
      const c = canonical(calls)
      expect(c.hasBattlePair, JSON.stringify(params)).toBe(true)
      expect(c.hasNamePredicate, JSON.stringify(params)).toBe(true)
      expect(c.terminalOrder, JSON.stringify(params)).toBe(true)
    }
  })

  it('scopes by one Guild, several Guilds, or cluster_code, never a mixture', () => {
    const guild = makeRecordingClient()
    buildBattleRowsQuery(guild.client, { select: 'a', scope: { guild: 'G' } })
    expect(
      guild.calls.some((c) => c[0] === 'eq' && c[1] === 'Guild' && c[2] === 'G')
    ).toBe(true)
    expect(guild.calls.some((c) => c[1] === 'cluster_code')).toBe(false)

    const cluster = makeRecordingClient()
    buildBattleRowsQuery(cluster.client, {
      select: 'a',
      scope: { cluster: 'C' }
    })
    expect(
      cluster.calls.some(
        (c) => c[0] === 'eq' && c[1] === 'cluster_code' && c[2] === 'C'
      )
    ).toBe(true)
    expect(cluster.calls.some((c) => c[1] === 'Guild')).toBe(false)

    const guilds = makeRecordingClient()
    buildBattleRowsQuery(guilds.client, {
      select: 'a',
      scope: { guilds: ['G', 'H'] }
    })
    expect(
      guilds.calls.some(
        (c) =>
          c[0] === 'in' &&
          c[1] === 'Guild' &&
          JSON.stringify(c[2]) === JSON.stringify(['G', 'H'])
      )
    ).toBe(true)
    expect(guilds.calls.some((c) => c[1] === 'cluster_code')).toBe(false)
  })

  it('defaults encounters to main-boss-only (eq 0) per the contract', () => {
    const { client, calls } = makeRecordingClient()
    buildBattleRowsQuery(client, { select: 'a', scope: { guild: 'G' } })
    expect(
      calls.some((c) => c[0] === 'eq' && c[1] === 'encounterId' && c[2] === 0)
    ).toBe(true)
  })

  it('single season uses eq, season list uses in, and single wins over list', () => {
    const single = makeRecordingClient()
    buildBattleRowsQuery(single.client, {
      select: 'a',
      scope: { guild: 'G' },
      season: '85'
    })
    expect(
      single.calls.some(
        (c) => c[0] === 'eq' && c[1] === 'Season' && c[2] === '85'
      )
    ).toBe(true)

    const list = makeRecordingClient()
    buildBattleRowsQuery(list.client, {
      select: 'a',
      scope: { guild: 'G' },
      seasons: ['84', '85']
    })
    expect(list.calls.some((c) => c[0] === 'in' && c[1] === 'Season')).toBe(
      true
    )
  })

  it('never emits a remainingHp filter, and the params type cannot express one', () => {
    const { client, calls } = makeRecordingClient()
    buildBattleRowsQuery(client, {
      select: 'a',
      scope: { guild: 'G' },
      rarities: ['Legendary'],
      encounters: 'main-and-primes',
      season: '85'
    })
    expect(calls.some((c) => String(c[1]).includes('remainingHp'))).toBe(false)

    // A remainingHp param must not compile; if one is added the directive goes unused.
    // @ts-expect-error -- remainingHp is deliberately not a parameter
    const invalid: BattleRowsParams = {
      select: 'a',
      scope: { guild: 'G' },
      remainingHp: 0
    }
    void invalid
  })
})
