import { describe, expect, it } from 'vitest'
import {
  makeTargetLabel,
  makeTargetUid,
  parseTargetUid
} from '@/app/lib/boss-assignments/season-planner/identifiers'

describe('season planner target identifiers', () => {
  it('builds and parses target_uids', () => {
    const uid = makeTargetUid({
      seasonId: 'season-91',
      loopIndex: 7,
      stageCode: 'L2',
      encounterId: 0
    })

    expect(parseTargetUid(uid)).toEqual({
      seasonId: 'season-91',
      loopIndex: 7,
      stageCode: 'L2',
      encounterId: 0
    })
  })

  it('builds target labels', () => {
    expect(makeTargetLabel('L2', 0)).toBe('L2')
    expect(makeTargetLabel('L2', 1)).toBe('L2_Sub1')
    expect(makeTargetLabel('L2', 2)).toBe('L2_Sub2')
  })

  it('rejects invalid target_uids', () => {
    expect(parseTargetUid('')).toBeNull()
    expect(parseTargetUid('a:b:c')).toBeNull()
    expect(parseTargetUid('a:b:c:d:e')).toBeNull()
    expect(parseTargetUid('season:NaN:L2:0')).toBeNull()
    expect(parseTargetUid('season:-1:L2:0')).toBeNull()
    expect(parseTargetUid('season:1::0')).toBeNull()
    expect(parseTargetUid('season:1:L2:3')).toBeNull()
  })
})
