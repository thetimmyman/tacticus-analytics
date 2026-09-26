import { describe, expect, it, vi } from 'vitest'

import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

describe('guildRosterQuery', () => {
  it.each(['player_id', 'player_id, display_name', '*'])(
    'always scopes %s to the current guild roster',
    (projection) => {
      const calls: Array<[string, ...unknown[]]> = []
      const chain = {
        select: vi.fn((...args: unknown[]) => {
          calls.push(['select', ...args])
          return chain
        }),
        eq: vi.fn((...args: unknown[]) => {
          calls.push(['eq', ...args])
          return chain
        })
      }
      const client = {
        from: vi.fn((...args: unknown[]) => {
          calls.push(['from', ...args])
          return chain
        })
      } as unknown as TypedSupabaseClient

      guildRosterQuery(client, 'ABC', projection)

      expect(calls).toEqual([
        ['from', 'player_mapping'],
        ['select', projection],
        ['eq', 'guild_code', 'ABC'],
        ['eq', 'is_current', true]
      ])
    }
  )

  it('preserves select count options', () => {
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn() })) }))
    const client = {
      from: vi.fn(() => ({ select }))
    } as unknown as TypedSupabaseClient

    guildRosterQuery(client, 'ABC', 'id', { count: 'exact' })

    expect(select).toHaveBeenCalledWith('id', { count: 'exact' })
  })
})
