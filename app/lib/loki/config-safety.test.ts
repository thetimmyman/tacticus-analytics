import { describe, expect, it } from 'vitest'
import { isSafeContentsRoll, safetySignature } from './config-safety'

const cfg = (over: Record<string, unknown> = {}) => {
  const { guildBoss, ...rest } = over
  return {
    configVersion: 'aaaa',
    ...rest,
    guildBoss: {
      guildBossSeasonConfigRotation: ['c1', 'c2', 'c3', 'c4', 'c5'],
      misc: { firstSeasonStart: 1700000000, seasonDuration: 2419200 },
      guildBossSeasonDataConfigsGDTO: { c1: { tiers: [] } },
      ...((guildBoss as object) ?? {})
    }
  }
}

describe('WI-8230 safe-contents-roll guard', () => {
  it('roster-only / version-only changes are safe', () => {
    const a = cfg()
    const b = cfg({
      configVersion: 'bbbb',
      guildBoss: {
        guildBossSeasonDataConfigsGDTO: { c1: { tiers: [{ different: true }] } }
      }
    })
    expect(isSafeContentsRoll(a, b)).toBe(true)
  })

  it('a rotation-list change is unsafe', () => {
    const b = cfg({
      guildBoss: {
        guildBossSeasonConfigRotation: ['c1', 'c2', 'c3', 'c4', 'c6']
      }
    })
    expect(isSafeContentsRoll(cfg(), b)).toBe(false)
  })

  it('a season-epoch change is unsafe', () => {
    const b = cfg({
      guildBoss: {
        guildBossSeasonConfigRotation: ['c1', 'c2', 'c3', 'c4', 'c5'],
        misc: { firstSeasonStart: 1700009999, seasonDuration: 2419200 }
      }
    })
    expect(isSafeContentsRoll(cfg(), b)).toBe(false)
  })

  it('a season-duration change is unsafe', () => {
    const b = cfg({
      guildBoss: {
        guildBossSeasonConfigRotation: ['c1', 'c2', 'c3', 'c4', 'c5'],
        misc: { firstSeasonStart: 1700000000, seasonDuration: 1209600 }
      }
    })
    expect(isSafeContentsRoll(cfg(), b)).toBe(false)
  })

  it('a bufferAfterSeasonEnd change is unsafe (it shifts season boundaries)', () => {
    // bufferAfterSeasonEnd shifts every season index (here and in
    // merge-season-lineups.cjs), so drift must never auto-adopt.
    const b = cfg({
      guildBoss: {
        guildBossSeasonConfigRotation: ['c1', 'c2', 'c3', 'c4', 'c5'],
        misc: {
          firstSeasonStart: 1700000000,
          seasonDuration: 2419200,
          bufferAfterSeasonEnd: 172800
        }
      }
    })
    expect(
      isSafeContentsRoll(
        cfg({
          guildBoss: {
            misc: {
              firstSeasonStart: 1700000000,
              seasonDuration: 2419200,
              bufferAfterSeasonEnd: 86400
            }
          }
        }),
        b
      )
    ).toBe(false)
  })

  it('tolerates malformed/empty configs without throwing', () => {
    expect(safetySignature(null)).toBe(safetySignature(undefined))
    expect(isSafeContentsRoll({}, { guildBoss: {} })).toBe(true)
  })
})
