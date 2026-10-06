import { describe, expect, it } from 'vitest'
import {
  validatePassword,
  PASSWORD_MIN_LENGTH,
  safeExternalHttpUrl,
  validateUrl
} from '@/app/lib/validation/auth'

// At least as strict as the auth server policy (min 12, lower:upper:digit).
describe('validatePassword', () => {
  it('exports the canonical minimum length as 12', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
  })

  it('rejects an 11-character password even with all three character classes', () => {
    const fixture = 'Passw0rd123'
    expect(fixture.length).toBe(11)
    const result = validatePassword(fixture)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('12 characters')
  })

  it('rejects a 12-character password missing a digit', () => {
    const fixture = 'PasswordAbcd'
    expect(fixture.length).toBe(12)
    const result = validatePassword(fixture)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('number')
  })

  it('rejects a 12-character password missing an uppercase letter', () => {
    const result = validatePassword('password1234')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('uppercase')
  })

  it('rejects a 12-character password missing a lowercase letter', () => {
    const result = validatePassword('PASSWORD1234')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('lowercase')
  })

  it('rejects a 12-character password with all three classes but no special character', () => {
    const fixture = 'Password1234'
    expect(fixture.length).toBe(12)
    const result = validatePassword(fixture)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('special character')
  })

  it('rejects a 12-character password that meets every class but is on the common-password blocklist', () => {
    const fixture = 'Password123!'
    expect(fixture.length).toBe(12)
    expect(/[a-z]/.test(fixture)).toBe(true)
    expect(/[A-Z]/.test(fixture)).toBe(true)
    expect(/\d/.test(fixture)).toBe(true)
    expect(/[!@#$%^&*(),.?":{}|<>]/.test(fixture)).toBe(true)
    const result = validatePassword(fixture)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('too common')
  })

  it('accepts a 12-character password with lowercase, uppercase, a digit, and a special character', () => {
    const fixture = 'Ferrum9War!x'
    expect(fixture.length).toBe(12)
    const result = validatePassword(fixture)
    expect(result.isValid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('rejects an empty password', () => {
    const result = validatePassword('')
    expect(result.isValid).toBe(false)
    expect(result.error).toBe('Password is required')
  })
})

describe('local external links', () => {
  it('normalizes HTTP links and permits clearing', () => {
    expect(safeExternalHttpUrl('https://example.invalid')).toBe(
      'https://example.invalid/'
    )
    expect(safeExternalHttpUrl('http://example.invalid/synthetic')).toBe(
      'http://example.invalid/synthetic'
    )
    expect(safeExternalHttpUrl('')).toBe('')
  })

  it('refuses privileged schemes, credentials, controls and oversized links', () => {
    for (const value of [
      'javascript:alert(1)',
      'file:///synthetic',
      'data:text/html,synthetic',
      'https://synthetic:synthetic@example.invalid',
      'https://example.invalid/\nsynthetic',
      'https://example.invalid/' + 'a'.repeat(2048),
      'synthetic-invalid-url'
    ])
      expect(safeExternalHttpUrl(value)).toBe('')
    // Existing hosted URL validation retains its contract.
    expect(validateUrl('file:///synthetic')).toBe(true)
  })
})
