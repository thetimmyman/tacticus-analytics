import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock } = vi.hoisted(() => ({ dbMock: vi.fn() }))

vi.mock('@/app/lib/db', () => ({ db: dbMock }))

import {
  loadCommunityReplayFacets,
  loadCommunityReplayPage
} from '@/app/lib/replays/community-replay-catalog'
import { TERMINUS_SOURCE_SYSTEM } from '@/app/lib/replays/replay-source'
import { isCatalogSort } from '@/app/lib/replays/community-replay-catalog-shared'

type QueryResult = {
  data: Array<Record<string, unknown>>
  error: { message: string } | null
  count?: number | null
}

const queryDouble = (result: QueryResult) => {
  const calls: Array<[string, ...unknown[]]> = []
  const query: Record<string, unknown> = {
    then: (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(resolve)
  }

  for (const method of [
    'select',
    'eq',
    'not',
    'or',
    'order',
    'range',
    'limit'
  ]) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return query
    }
  }

  return { calls, query }
}

describe('community replay catalog source boundary', () => {
  beforeEach(() => dbMock.mockReset())

  it('always scopes catalog rows to Terminus Maximus', async () => {
    const { calls, query } = queryDouble({ data: [], error: null, count: 0 })
    dbMock.mockResolvedValue({ from: () => query })

    await loadCommunityReplayPage({ search: 'Magnus,*(test)' })

    expect(calls).toContainEqual([
      'eq',
      'source_system',
      TERMINUS_SOURCE_SYSTEM
    ])
    expect(calls.find(([method]) => method === 'or')?.[1]).toBe(
      'title.ilike.%Magnus test%,boss_id.ilike.%Magnus test%'
    )
  })

  it('uses the same source boundary for facet counts', async () => {
    const { calls, query } = queryDouble({ data: [], error: null })
    dbMock.mockResolvedValue({ from: () => query })

    await loadCommunityReplayFacets()

    expect(calls).toContainEqual([
      'eq',
      'source_system',
      TERMINUS_SOURCE_SYSTEM
    ])
  })

  it('links raw boss identifiers to the canonical playbook slug', async () => {
    const { query } = queryDouble({
      data: [
        {
          id: 'replay-1',
          boss_id: 'AvatarOfKhaine',
          title: 'Clean run'
        }
      ],
      error: null,
      count: 1
    })
    dbMock.mockResolvedValue({ from: () => query })

    const page = await loadCommunityReplayPage({})

    expect(page.replays[0]?.href).toBe(
      '/boss-playbooks/avatar-of-khaine?replay=replay-1'
    )
  })

  it('accepts only own sort-registry keys', () => {
    expect(isCatalogSort('damage')).toBe(true)
    expect(isCatalogSort('toString')).toBe(false)
    expect(isCatalogSort('__proto__')).toBe(false)
  })
})
