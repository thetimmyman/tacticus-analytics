import { describe, it, expect } from 'vitest'
import { ApiErrorCode, validateGuildCode } from '@tacticus/app-core/api-errors'

describe('API Errors', () => {
  describe('ApiErrorCode enum', () => {
    describe('Validation Errors (400)', () => {
      it('has validation error codes', () => {
        expect(ApiErrorCode.MISSING_REQUIRED_FIELDS).toBe(
          'MISSING_REQUIRED_FIELDS'
        )
        expect(ApiErrorCode.INVALID_GUILD_CODE).toBe('INVALID_GUILD_CODE')
        expect(ApiErrorCode.INVALID_API_KEY).toBe('INVALID_API_KEY')
        expect(ApiErrorCode.INVALID_WEBHOOK_URL).toBe('INVALID_WEBHOOK_URL')
        expect(ApiErrorCode.INVALID_SEASON).toBe('INVALID_SEASON')
        expect(ApiErrorCode.INVALID_REQUEST).toBe('INVALID_REQUEST')
      })
    })

    describe('Authorization Errors (401/403)', () => {
      it('has auth error codes', () => {
        expect(ApiErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED')
        expect(ApiErrorCode.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS')
        expect(ApiErrorCode.INSUFFICIENT_PERMISSIONS).toBe(
          'INSUFFICIENT_PERMISSIONS'
        )
        expect(ApiErrorCode.AUTHENTICATION_REQUIRED).toBe(
          'AUTHENTICATION_REQUIRED'
        )
        expect(ApiErrorCode.ADMIN_ACCESS_REQUIRED).toBe('ADMIN_ACCESS_REQUIRED')
      })
    })

    describe('Rate Limiting (429)', () => {
      it('has rate limit error code', () => {
        expect(ApiErrorCode.RATE_LIMITED).toBe('RATE_LIMITED')
      })
    })

    describe('Not Found Errors (404)', () => {
      it('has not found error codes', () => {
        expect(ApiErrorCode.USER_PROFILE_NOT_FOUND).toBe(
          'USER_PROFILE_NOT_FOUND'
        )
        expect(ApiErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND')
        expect(ApiErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND')
      })
    })

    describe('Conflict Errors (409)', () => {
      it('has conflict error codes', () => {
        expect(ApiErrorCode.GUILD_ALREADY_EXISTS).toBe('GUILD_ALREADY_EXISTS')
        expect(ApiErrorCode.PROTECTED_GUILD_CODE).toBe('PROTECTED_GUILD_CODE')
        expect(ApiErrorCode.DUPLICATE_REQUEST).toBe('DUPLICATE_REQUEST')
      })
    })

    describe('External Service Errors (502/503)', () => {
      it('has external service error codes', () => {
        expect(ApiErrorCode.LOKI_API_FAILURE).toBe('LOKI_API_FAILURE')
        expect(ApiErrorCode.TACTICUS_API_FAILURE).toBe('TACTICUS_API_FAILURE')
        expect(ApiErrorCode.DISCORD_API_FAILURE).toBe('DISCORD_API_FAILURE')
        expect(ApiErrorCode.EXTERNAL_API_ERROR).toBe('EXTERNAL_API_ERROR')
      })
    })

    describe('Database Errors (500)', () => {
      it('has database error codes', () => {
        expect(ApiErrorCode.DATABASE_ERROR).toBe('DATABASE_ERROR')
        expect(ApiErrorCode.SYNC_FAILURE).toBe('SYNC_FAILURE')
        expect(ApiErrorCode.FETCH_FAILED).toBe('FETCH_FAILED')
        expect(ApiErrorCode.UPDATE_FAILED).toBe('UPDATE_FAILED')
      })
    })

    describe('Internal Errors (500)', () => {
      it('has internal error codes', () => {
        expect(ApiErrorCode.ENCRYPTION_ERROR).toBe('ENCRYPTION_ERROR')
        expect(ApiErrorCode.CONFIGURATION_ERROR).toBe('CONFIGURATION_ERROR')
        expect(ApiErrorCode.INTERNAL_SERVER_ERROR).toBe('INTERNAL_SERVER_ERROR')
        expect(ApiErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR')
      })
    })
  })

  describe('validateGuildCode', () => {
    describe('valid guild codes', () => {
      it('accepts valid 2-letter codes', () => {
        const result = validateGuildCode('AB')
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      it('accepts valid 7-letter codes', () => {
        const result = validateGuildCode('ABCDEFG')
        expect(result.valid).toBe(true)
      })

      it('accepts lowercase and converts to uppercase', () => {
        const result = validateGuildCode('abc')
        expect(result.valid).toBe(true)
      })

      it('trims whitespace', () => {
        const result = validateGuildCode('  ABC  ')
        expect(result.valid).toBe(true)
      })
    })

    describe('invalid guild codes', () => {
      it('rejects empty string', () => {
        const result = validateGuildCode('')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.MISSING_REQUIRED_FIELDS)
      })

      it('rejects null-like values', () => {
        const result = validateGuildCode(null as unknown as string)
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.MISSING_REQUIRED_FIELDS)
      })

      it('rejects codes shorter than 2 characters', () => {
        const result = validateGuildCode('A')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.INVALID_GUILD_CODE)
      })

      it('rejects codes longer than 7 characters', () => {
        const result = validateGuildCode('ABCDEFGH')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.INVALID_GUILD_CODE)
      })

      it('rejects codes with numbers', () => {
        const result = validateGuildCode('ABC123')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.INVALID_GUILD_CODE)
      })

      it('rejects codes with special characters', () => {
        const result = validateGuildCode('ABC-DEF')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.INVALID_GUILD_CODE)
      })

      it('rejects codes with spaces', () => {
        const result = validateGuildCode('AB CD')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.INVALID_GUILD_CODE)
      })
    })

    describe('protected guild codes', () => {
      it('rejects TEST', () => {
        const result = validateGuildCode('TEST')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.PROTECTED_GUILD_CODE)
      })

      it('rejects DEMO', () => {
        const result = validateGuildCode('DEMO')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.PROTECTED_GUILD_CODE)
      })

      it('rejects protected codes case-insensitively', () => {
        const result = validateGuildCode('test')
        expect(result.valid).toBe(false)
        expect(result.error).toBe(ApiErrorCode.PROTECTED_GUILD_CODE)
      })

      it.each(['EOT', 'IW', 'AL', 'DA', 'HL', 'IH', 'RG', 'TS', 'PIQBM'])(
        'accepts legitimate in-game guild tag: %s',
        (tag) => {
          const result = validateGuildCode(tag)
          expect(result.valid).toBe(true)
        }
      )
    })

    describe('error messages', () => {
      it('provides helpful message for missing code', () => {
        const result = validateGuildCode('')
        expect(result.message).toBe('Guild code is required')
      })

      it('provides helpful message for invalid format', () => {
        const result = validateGuildCode('A')
        expect(result.message).toBe('Guild code must be 2-7 uppercase letters')
      })

      it('provides specific message for protected codes', () => {
        const result = validateGuildCode('TEST')
        expect(result.message).toContain('TEST')
        expect(result.message).toContain('reserved')
        expect(result.message).toContain('cannot be created')
      })
    })
  })
})
