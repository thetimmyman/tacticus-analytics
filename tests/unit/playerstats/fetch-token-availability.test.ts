import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTokenAvailability } from '@/app/components/playerstats/hooks/data-fetchers/fetchTokenAvailability'

const selection = {
  playerName: 'Synthetic Commander',
  guildCode: 'SYN001',
  season: '9999',
  selectedGuild: 'SYN001',
  userRole: 'member',
  effectiveClusterCode: 'SYN-CLUSTER'
}
afterEach(() => vi.unstubAllGlobals())
describe('token availability follows the guild-token route role boundary', () => {
  it.each(['member', 'admin', 'unknown'])(
    'does not request officer-only data for %s',
    async (userRole) => {
      const request = vi.fn()
      vi.stubGlobal('fetch', request)
      expect(
        await fetchTokenAvailability({ ...selection, userRole })
      ).toBeNull()
      expect(request).not.toHaveBeenCalled()
    }
  )
  it('keeps the existing officer request and calculated result', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          players: [
            {
              display_name: selection.playerName,
              tokens_available: 3,
              bombs_available: 0,
              data_source: 'calculated',
              tokens_used: 4
            }
          ]
        })
      )
    )
    vi.stubGlobal('fetch', request)
    const result = await fetchTokenAvailability({
      ...selection,
      userRole: 'Officer'
    })
    expect(request).toHaveBeenCalledWith(
      '/api/guild-tokens?guild=SYN001&season=9999',
      { credentials: 'include' }
    )
    expect(result).toMatchObject({
      tokens: 3,
      bombs: 0,
      dataSource: 'calculated',
      tokensUsed: 4
    })
  })
})
