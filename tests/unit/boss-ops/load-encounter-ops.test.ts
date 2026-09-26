import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHeraldConfigsByBossId } from '@/app/lib/boss-ops/load-encounter-ops'

const { dbMock } = vi.hoisted(() => ({ dbMock: vi.fn() }))

vi.mock('@/app/lib/db', () => ({ db: dbMock }))

describe('loadHeraldConfigsByBossId', () => {
  beforeEach(() => {
    dbMock.mockReset()
  })

  it('keeps only canonically valid Discord snowflakes in role labels', async () => {
    const isMock = vi.fn().mockResolvedValue({
      data: [
        {
          boss_id: 'Magnus_E0',
          discord_role_ids: [],
          discord_role_labels: {
            '11111111111111111': ' Seventeen digits ',
            '22222222222222222222': 'Twenty digits',
            '3333333333333333': 'Too short',
            '444444444444444444444': 'Too long',
            '<@&555555555555555555>': 'Discord mention syntax',
            '666666666666666666': '   '
          }
        }
      ],
      error: null
    })
    const eqMock = vi.fn().mockReturnValue({ is: isMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })
    dbMock.mockResolvedValue({ from: fromMock })

    const result = await loadHeraldConfigsByBossId('TESTGUILD', true)

    expect(result.loadFailed).toBe(false)
    expect(result.byBossId.Magnus_E0?.discordRoleLabels).toEqual({
      '11111111111111111': 'Seventeen digits',
      '22222222222222222222': 'Twenty digits'
    })
    expect(fromMock).toHaveBeenCalledWith('herald_boss_config')
    expect(eqMock).toHaveBeenCalledWith('guild_code', 'TESTGUILD')
    expect(isMock).toHaveBeenCalledWith('rarity_set', null)
  })
})
