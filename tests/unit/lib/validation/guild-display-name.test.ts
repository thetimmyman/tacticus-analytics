import { describe, it, expect } from 'vitest'
import {
  GUILD_DISPLAY_NAME_MAX_LENGTH,
  validateGuildDisplayName
} from '@/app/lib/validation/guild-display-name'

// Fixtures are synthetic; never use real guild names or user emails.

describe('validateGuildDisplayName', () => {
  it('accepts a normal name and returns it trimmed', () => {
    expect(validateGuildDisplayName('  Iron Wardens  ')).toEqual({
      ok: true,
      value: 'Iron Wardens'
    })
  })

  it('accepts names with symbols that are not emails', () => {
    expect(validateGuildDisplayName('EoT《Bracketed》RG').ok).toBe(true)
    expect(validateGuildDisplayName('Team@Home').ok).toBe(true)
  })

  it('rejects empty and whitespace-only names', () => {
    expect(validateGuildDisplayName('').ok).toBe(false)
    expect(validateGuildDisplayName('   ').ok).toBe(false)
    expect(validateGuildDisplayName(undefined).ok).toBe(false)
    expect(validateGuildDisplayName(42).ok).toBe(false)
  })

  it('rejects an email address', () => {
    const result = validateGuildDisplayName(' leader.one@example.com ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/email/i)
  })

  it('rejects a name that contains an email address', () => {
    expect(
      validateGuildDisplayName('Iron Wardens leader.one@example.com').ok
    ).toBe(false)
  })

  it('enforces the maximum length after trimming', () => {
    const atLimit = 'a'.repeat(GUILD_DISPLAY_NAME_MAX_LENGTH)
    expect(validateGuildDisplayName(`  ${atLimit}  `)).toEqual({
      ok: true,
      value: atLimit
    })
    const result = validateGuildDisplayName(`${atLimit}a`)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toContain(String(GUILD_DISPLAY_NAME_MAX_LENGTH))
  })
})
