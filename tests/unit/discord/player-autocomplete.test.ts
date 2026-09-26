import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlayerAutocompleteChoices } from '@/app/api/discord/interactions/command-handlers/autocomplete'
import type { Supabase } from '@/app/api/discord/interactions/command-handlers/types'
import type { APIApplicationCommandAutocompleteInteraction } from 'discord-api-types/v10'

const mocks = vi.hoisted(() => ({
  getLinkedGuilds: vi.fn(),
  getMemberLabelMap: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/utils/guild-resolution',
  () => ({
    getLinkedGuilds: mocks.getLinkedGuilds
  })
)
vi.mock('@/app/lib/member-labels-server', () => ({
  getMemberLabelMap: mocks.getMemberLabelMap
}))

type QueryResult = {
  data: Array<{ display_name: string }> | null
  error: { message: string } | null
}

const CHAIN_METHODS = ['select', 'in', 'eq', 'order', 'limit', 'ilike'] as const

// Records call order: .limit() without a preceding .order() is the bug.
const createRecordingQuery = (result: QueryResult) => {
  const callOrder: string[] = []
  const query = {
    callOrder,
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    ilike: vi.fn(),
    then: <R1, R2>(
      onFulfilled?: (value: QueryResult) => R1,
      onRejected?: (reason: Error) => R2
    ) => Promise.resolve(result).then(onFulfilled, onRejected)
  }
  for (const method of CHAIN_METHODS) {
    query[method].mockImplementation(() => {
      callOrder.push(method)
      return query
    })
  }
  return query
}

const buildInteraction = (
  options: Array<{
    name: string
    type: number
    focused?: boolean
    value?: string
  }>
) =>
  ({
    guild_id: 'discord-guild-1',
    data: { name: 'player-stats', options }
  }) as unknown as APIApplicationCommandAutocompleteInteraction

const linkedGuild = (code: string) => ({
  guildCode: code,
  guildTag: code,
  clusterCode: 'EOT',
  displayName: `Guild ${code}`
})

describe('getPlayerAutocompleteChoices deterministic ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLinkedGuilds.mockResolvedValue([linkedGuild('AAAAA')])
    mocks.getMemberLabelMap.mockResolvedValue(new Map())
  })

  it('orders before loading the larger alias-search candidate window', async () => {
    const query = createRecordingQuery({
      data: [{ display_name: 'Alpha' }, { display_name: 'Beta' }],
      error: null
    })
    const supabase = {
      from: vi.fn().mockReturnValue(query)
    } as unknown as Supabase

    const choices = await getPlayerAutocompleteChoices(
      supabase,
      buildInteraction([{ name: 'player', type: 3, focused: true, value: 'a' }])
    )

    expect(choices).toEqual([
      { name: 'Alpha', value: 'Alpha' },
      { name: 'Beta', value: 'Beta' }
    ])
    expect(query.order).toHaveBeenCalledWith('display_name')
    expect(query.limit).toHaveBeenCalledWith(250)
    const orderIndex = query.callOrder.indexOf('order')
    const limitIndex = query.callOrder.indexOf('limit')
    expect(orderIndex).toBeGreaterThanOrEqual(0)
    expect(limitIndex).toBeGreaterThan(orderIndex)
    expect(query.ilike).toHaveBeenCalledWith('display_name', '%a%')
    expect(query.in).toHaveBeenCalledWith('guild_code', ['AAAAA'])
  })

  it('queries alias-matched raw names separately within the linked guild', async () => {
    mocks.getMemberLabelMap.mockResolvedValue(
      new Map([['SharedName (GUILD_A)', 'SharedName (GUILD_B)']])
    )
    const rawQuery = createRecordingQuery({ data: [], error: null })
    const aliasQuery = createRecordingQuery({
      data: [{ display_name: 'SharedName (GUILD_A)' }],
      error: null
    })
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(rawQuery)
        .mockReturnValueOnce(aliasQuery)
    } as unknown as Supabase

    const choices = await getPlayerAutocompleteChoices(
      supabase,
      buildInteraction([
        { name: 'player', type: 3, focused: true, value: 'guild_b' }
      ])
    )

    expect(choices).toEqual([
      { name: 'SharedName (GUILD_B)', value: 'SharedName (GUILD_A)' }
    ])
    expect(rawQuery.ilike).toHaveBeenCalledWith('display_name', '%guild_b%')
    expect(aliasQuery.in).toHaveBeenCalledWith('display_name', [
      'SharedName (GUILD_A)'
    ])
  })

  it('still orders before limiting when no option is focused (no ilike filter)', async () => {
    const query = createRecordingQuery({
      data: [{ display_name: 'Alpha' }],
      error: null
    })
    const supabase = {
      from: vi.fn().mockReturnValue(query)
    } as unknown as Supabase

    const choices = await getPlayerAutocompleteChoices(
      supabase,
      buildInteraction([{ name: 'player', type: 3, value: 'ignored' }])
    )

    expect(choices).toEqual([{ name: 'Alpha', value: 'Alpha' }])
    expect(query.ilike).not.toHaveBeenCalled()
    const orderIndex = query.callOrder.indexOf('order')
    const limitIndex = query.callOrder.indexOf('limit')
    expect(orderIndex).toBeGreaterThanOrEqual(0)
    expect(limitIndex).toBeGreaterThan(orderIndex)
  })

  it('returns no choices when the server has no linked guilds', async () => {
    mocks.getLinkedGuilds.mockResolvedValue([])
    const from = vi.fn()

    const choices = await getPlayerAutocompleteChoices(
      { from } as unknown as Supabase,
      buildInteraction([{ name: 'player', type: 3, focused: true, value: 'a' }])
    )

    expect(choices).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})
