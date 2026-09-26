import { describe, expect, it } from 'vitest'
import { normalizeInviteCode } from '@/app/lib/onboarding/invite-code-normalization'

describe('normalizeInviteCode', () => {
  it('uppercases invite codes', () => {
    expect(normalizeInviteCode('a1b2c3d4e5f6')).toBe('A1B2C3D4E5F6')
  })

  it('removes surrounding and embedded whitespace from copied codes', () => {
    expect(normalizeInviteCode(' \ta1b2 c3d4\ne5f6\r ')).toBe('A1B2C3D4E5F6')
  })

  it('preserves non-whitespace characters without performing validation', () => {
    expect(normalizeInviteCode('ab-cd')).toBe('AB-CD')
  })
})
