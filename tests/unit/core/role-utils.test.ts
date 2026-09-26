import { describe, it, expect } from 'vitest'
import { normalizeTacticusGuildRole } from '@tacticus/app-core/role-utils'

describe('normalizeTacticusGuildRole (WI-2212)', () => {
  it('maps leader variants (incl. co-leader) to leader', () => {
    for (const r of [
      'LEADER',
      'GUILD_LEADER',
      'CO_LEADER',
      'COLEADER',
      'co_leader',
      ' Leader '
    ]) {
      expect(normalizeTacticusGuildRole(r)).toBe('leader')
    }
  })

  it('maps officer variants to officer', () => {
    expect(normalizeTacticusGuildRole('OFFICER')).toBe('officer')
    expect(normalizeTacticusGuildRole('guild_officer')).toBe('officer')
  })

  it('defaults everything else (incl. null/unknown) to member', () => {
    expect(normalizeTacticusGuildRole(null)).toBe('member')
    expect(normalizeTacticusGuildRole(undefined)).toBe('member')
    expect(normalizeTacticusGuildRole('')).toBe('member')
    expect(normalizeTacticusGuildRole('MEMBER')).toBe('member')
    expect(normalizeTacticusGuildRole('initiate')).toBe('member')
  })
})
