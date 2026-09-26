import { describe, it, expect } from 'vitest'
import { looksLikeEmail, maskEmail, resolveApiOwnerDisplay } from './apiOwner'

// Fixtures are synthetic; never use real user emails or in-game handles.

describe('looksLikeEmail', () => {
  it('detects email-shaped values', () => {
    expect(looksLikeEmail('player746@example.com')).toBe(true)
    expect(looksLikeEmail('  guild.member@example.net ')).toBe(true)
  })

  it('rejects non-email labels', () => {
    expect(looksLikeEmail('Gloriana')).toBe(false)
    expect(looksLikeEmail('EoT《Bracketed》RG')).toBe(false)
    expect(looksLikeEmail('not @ an email')).toBe(false)
  })
})

describe('maskEmail', () => {
  it('keeps the first local char and the domain', () => {
    expect(maskEmail('player746@example.com')).toBe('p•••@example.com')
    expect(maskEmail('invader00@example.org')).toBe('i•••@example.org')
  })

  it('handles degenerate input without leaking', () => {
    expect(maskEmail('@nodomain.com')).toBe('•••')
  })
})

describe('resolveApiOwnerDisplay', () => {
  it('prefers the resolved player display name', () => {
    expect(resolveApiOwnerDisplay('player746@example.com', 'Player746')).toBe(
      'Player746'
    )
    expect(resolveApiOwnerDisplay('Gloriana', 'GloriAna')).toBe('GloriAna')
  })

  it('masks an email when no player name resolves', () => {
    expect(resolveApiOwnerDisplay('player746@example.com', null)).toBe(
      'p•••@example.com'
    )
    expect(resolveApiOwnerDisplay('guild.member@example.net', undefined)).toBe(
      'g•••@example.net'
    )
  })

  it('passes through non-email labels unchanged', () => {
    expect(resolveApiOwnerDisplay('Gloriana', null)).toBe('Gloriana')
    expect(resolveApiOwnerDisplay('  OperatorName  ', '')).toBe('OperatorName')
  })

  it('returns null when there is nothing to show', () => {
    expect(resolveApiOwnerDisplay(null, null)).toBeNull()
    expect(resolveApiOwnerDisplay('', '   ')).toBeNull()
  })
})
