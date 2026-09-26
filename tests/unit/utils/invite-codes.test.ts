import { describe, it, expect } from 'vitest'
import { validateInviteCodeFormat } from '@/app/lib/utils/invite-codes'

describe('Invite Code Utilities', () => {
  describe('validateInviteCodeFormat', () => {
    describe('valid codes', () => {
      it('accepts valid uppercase alphanumeric codes', () => {
        expect(validateInviteCodeFormat('ABCDEF')).toBe(true)
        expect(validateInviteCodeFormat('ABC123')).toBe(true)
        expect(validateInviteCodeFormat('123456')).toBe(true)
      })

      it('accepts codes at minimum length (6)', () => {
        expect(validateInviteCodeFormat('ABCDEF')).toBe(true)
        expect(validateInviteCodeFormat('123456')).toBe(true)
      })

      it('accepts codes at maximum length (20)', () => {
        expect(validateInviteCodeFormat('ABCDEFGHIJ1234567890')).toBe(true)
      })

      it('accepts codes between min and max length', () => {
        expect(validateInviteCodeFormat('ABCDEFGH')).toBe(true)
        expect(validateInviteCodeFormat('ABCDEFGHIJ')).toBe(true)
        expect(validateInviteCodeFormat('ABCDEFGHIJ12345')).toBe(true)
      })
    })

    describe('invalid codes', () => {
      it('rejects null', () => {
        expect(validateInviteCodeFormat(null as unknown as string)).toBe(false)
      })

      it('rejects undefined', () => {
        expect(validateInviteCodeFormat(undefined as unknown as string)).toBe(
          false
        )
      })

      it('rejects empty string', () => {
        expect(validateInviteCodeFormat('')).toBe(false)
      })

      it('rejects codes shorter than 6 characters', () => {
        expect(validateInviteCodeFormat('A')).toBe(false)
        expect(validateInviteCodeFormat('AB')).toBe(false)
        expect(validateInviteCodeFormat('ABC')).toBe(false)
        expect(validateInviteCodeFormat('ABCD')).toBe(false)
        expect(validateInviteCodeFormat('ABCDE')).toBe(false)
      })

      it('rejects codes longer than 20 characters', () => {
        expect(validateInviteCodeFormat('ABCDEFGHIJ12345678901')).toBe(false)
        expect(validateInviteCodeFormat('A'.repeat(21))).toBe(false)
        expect(validateInviteCodeFormat('A'.repeat(50))).toBe(false)
      })

      it('rejects lowercase letters', () => {
        expect(validateInviteCodeFormat('abcdef')).toBe(false)
        expect(validateInviteCodeFormat('Abcdef')).toBe(false)
        expect(validateInviteCodeFormat('ABCdef')).toBe(false)
      })

      it('rejects special characters', () => {
        expect(validateInviteCodeFormat('ABC-DE')).toBe(false)
        expect(validateInviteCodeFormat('ABC_DE')).toBe(false)
        expect(validateInviteCodeFormat('ABC DE')).toBe(false)
        expect(validateInviteCodeFormat('ABC!DE')).toBe(false)
        expect(validateInviteCodeFormat('ABC@DE')).toBe(false)
      })

      it('rejects non-string types', () => {
        expect(validateInviteCodeFormat(123456 as unknown as string)).toBe(
          false
        )
        expect(validateInviteCodeFormat({} as unknown as string)).toBe(false)
        expect(validateInviteCodeFormat([] as unknown as string)).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('rejects strings with only whitespace', () => {
        expect(validateInviteCodeFormat('      ')).toBe(false)
        expect(validateInviteCodeFormat('   ABCDEF   ')).toBe(false) // Has spaces
      })

      it('handles numeric-only codes', () => {
        expect(validateInviteCodeFormat('123456')).toBe(true)
        expect(validateInviteCodeFormat('000000')).toBe(true)
      })

      it('handles letter-only codes', () => {
        expect(validateInviteCodeFormat('ABCDEF')).toBe(true)
        expect(validateInviteCodeFormat('ZZZZZZ')).toBe(true)
      })
    })
  })
})
