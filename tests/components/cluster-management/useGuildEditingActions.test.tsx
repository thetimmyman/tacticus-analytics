import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGuildEditingActions } from '@/app/(dashboard)/leaderboards/components/cluster-management/hooks/useGuildEditingActions'
import type { Guild } from '@/app/(dashboard)/leaderboards/components/cluster-management/types'

// Fixtures are synthetic; never use real guild codes, names or emails.

const mockFrom = vi.hoisted(() => vi.fn())
const updates = vi.hoisted(
  () => [] as Array<{ table: string; payload: Record<string, unknown> }>
)
const updateResult = vi.hoisted(() => ({
  current: {
    data: [{ guild_code: 'GUILD1' }] as unknown[] | null,
    error: null as unknown
  }
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({ from: mockFrom })
}))

const baseGuild: Guild = {
  guild_code: 'GUILD1',
  guild_tag: 'GUILD1',
  display_name: 'Old Name',
  has_api_key: false,
  API_Owner: null,
  enabled: true,
  GR_Ranking: null,
  GW_Ranking: null,
  token_offender_threshold: 3,
  token_abuser_threshold: 5,
  cluster_code: 'CLU'
}

function setup() {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  const fetchGuilds = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() =>
    useGuildEditingActions({
      guilds: [baseGuild],
      currentUserDisplayName: null,
      setGuilds: vi.fn(),
      fetchGuilds,
      toast
    })
  )
  return { result, toast, fetchGuilds }
}

async function editAndSave(
  result: ReturnType<typeof setup>['result'],
  displayName: string | null
) {
  act(() => result.current.handleEdit(baseGuild))
  act(() =>
    result.current.setEditedGuild({ ...baseGuild, display_name: displayName })
  )
  await act(async () => {
    await result.current.handleSaveEdit()
  })
}

describe('useGuildEditingActions display name editing', () => {
  beforeEach(() => {
    updates.length = 0
    updateResult.current = { data: [{ guild_code: 'GUILD1' }], error: null }
    mockFrom.mockImplementation((table: string) => ({
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        const chain = {
          eq: () => chain,
          select: () => Promise.resolve(updateResult.current)
        }
        return chain
      }
    }))
  })

  it('saves the trimmed display name with the other guild fields', async () => {
    const { result, toast, fetchGuilds } = setup()
    await editAndSave(result, '  New Name  ')

    expect(updates).toEqual([
      {
        table: 'guild_config',
        payload: expect.objectContaining({
          display_name: 'New Name',
          enabled: true,
          token_offender_threshold: 3,
          token_abuser_threshold: 5
        })
      }
    ])
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('New Name')
    )
    expect(fetchGuilds).toHaveBeenCalled()
    expect(result.current.editingGuild).toBeNull()
  })

  it('refuses an email address without writing and stays in edit mode', async () => {
    const { result, toast } = setup()
    await editAndSave(result, 'leader.one@example.com')

    expect(updates).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/email/i))
    expect(result.current.editingGuild).toBe('GUILD1')
  })

  it('refuses an empty display name without writing', async () => {
    const { result, toast } = setup()
    await editAndSave(result, '   ')

    expect(updates).toEqual([])
    expect(toast.error).toHaveBeenCalled()
  })

  it('reports an error when the update matched no row the caller may edit', async () => {
    updateResult.current = { data: [], error: null }
    const { result, toast } = setup()
    await editAndSave(result, 'New Name')

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/permission/i)
    )
    expect(result.current.editingGuild).toBe('GUILD1')
  })
})
