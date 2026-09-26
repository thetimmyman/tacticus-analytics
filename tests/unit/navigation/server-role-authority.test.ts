import { describe, expect, it } from 'vitest'
import { resolveServerNavigationRole } from '@/app/components/navigation/server-role-authority'

describe('resolveServerNavigationRole', () => {
  it('defaults a present null-role profile to member instead of session metadata', () => {
    expect(
      resolveServerNavigationRole({ role: null }, { role: 'leader' })
    ).toBe('member')
  })

  it('uses the server profile role when one is present', () => {
    expect(
      resolveServerNavigationRole({ role: 'officer' }, { role: 'leader' })
    ).toBe('officer')
  })

  it('allows session metadata only when no profile exists yet', () => {
    expect(resolveServerNavigationRole(null, { role: 'onboarding' })).toBe(
      'onboarding'
    )
  })

  it('defaults to member when neither source has a role', () => {
    expect(resolveServerNavigationRole(null, null)).toBe('member')
  })
})
