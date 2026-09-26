import { describe, it, expect } from 'vitest'
import {
  parseSupabaseError,
  validateFormFields,
  formatErrorForDisplay,
  type ParsedError,
  type FieldError
} from '@/app/lib/utils/error-handling'

describe('Error Handling Utilities', () => {
  describe('parseSupabaseError', () => {
    it('returns unknown error for null/undefined', () => {
      const result = parseSupabaseError(null)

      expect(result.type).toBe('unknown')
      expect(result.message).toBe('An unknown error occurred')
      expect(result.suggestion).toBeDefined()
    })

    it('parses RLS policy violations', () => {
      const error = {
        code: '42501',
        message: 'new row violates row-level security policy for table "users"'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('permission')
      expect(result.message).toContain("don't have permission")
    })

    it('parses unique constraint violations', () => {
      const error = {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        constraint: 'users_email_key'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('constraint')
      expect(result.message).toContain('already exists')
    })

    it('parses foreign key violations', () => {
      const error = {
        code: '23503',
        message: 'insert or update on table violates foreign key constraint',
        constraint: 'orders_user_id_fkey'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('constraint')
      expect(result.message).toContain('Invalid reference')
    })

    it('parses not null violations', () => {
      const error = {
        code: '23502',
        message: 'null value in column "email" violates not-null constraint'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('validation')
      expect(result.message).toContain('Required field')
      expect(result.fieldErrors).toBeDefined()
      expect(result.fieldErrors?.[0]?.field).toBe('email')
    })

    it('parses check constraint violations', () => {
      const error = {
        code: '23514',
        message: 'check constraint violation',
        constraint: 'check_token_thresholds'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('validation')
      expect(result.fieldErrors).toBeDefined()
    })

    it('parses invalid input format errors', () => {
      const error = {
        code: '22P02',
        message: 'invalid input syntax for type uuid'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('validation')
      expect(result.message).toBe('Invalid input format')
    })

    it('parses input too long errors', () => {
      const error = {
        code: '22001',
        message: 'value too long for type character varying(100)'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('validation')
      expect(result.message).toBe('Input too long')
    })

    it('parses authentication errors', () => {
      const error = {
        code: '28P01',
        message: 'password authentication failed'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('permission')
      expect(result.message).toBe('Authentication failed')
    })

    it('parses network errors', () => {
      const error = {
        name: 'FetchError',
        message: 'fetch failed'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('network')
      expect(result.message).toBe('Network connection error')
    })

    it('handles error with error_description field', () => {
      const error = {
        error_description: 'Custom error description'
      }

      const result = parseSupabaseError(error)

      expect(result.message).toBe('Custom error description')
    })

    it('handles update RLS policy violations', () => {
      const error = {
        code: '42501',
        message: 'update violates row-level security policy'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('permission')
      expect(result.message).toContain("don't have permission to update")
    })

    it('handles delete RLS policy violations', () => {
      const error = {
        code: '42501',
        message: 'delete violates row-level security policy'
      }

      const result = parseSupabaseError(error)

      expect(result.type).toBe('permission')
      expect(result.message).toContain("don't have permission to delete")
    })
  })

  describe('validateFormFields', () => {
    it('validates required fields', () => {
      const data = { name: '', email: 'test@test.com' }
      const rules = {
        name: { required: true }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('name')
      expect(errors[0].code).toBe('required')
    })

    it('validates minimum length', () => {
      const data = { name: 'ab' }
      const rules = {
        name: { minLength: 3, minLengthMessage: 'Name too short' }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('name')
      expect(errors[0].code).toBe('minLength')
    })

    it('validates maximum length', () => {
      const data = { name: 'very long name here' }
      const rules = {
        name: { maxLength: 10 }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('name')
      expect(errors[0].code).toBe('maxLength')
    })

    it('validates email format', () => {
      const data = { email: 'not-an-email' }
      const rules = {
        email: { email: true }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('email')
      expect(errors[0].code).toBe('email')
    })

    it('validates pattern', () => {
      const data = { code: 'abc123' }
      const rules = {
        code: {
          pattern: /^[A-Z]+$/,
          patternMessage: 'Must be uppercase letters'
        }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('code')
      expect(errors[0].code).toBe('pattern')
    })

    it('validates custom rules', () => {
      const data = { password: 'weak', confirmPassword: 'different' }
      const rules = {
        confirmPassword: {
          validate: (value: string, allData: Record<string, unknown>) => {
            return value !== allData.password ? 'Passwords must match' : null
          }
        }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(1)
      expect(errors[0].field).toBe('confirmPassword')
      expect(errors[0].message).toBe('Passwords must match')
    })

    it('returns empty array when all validations pass', () => {
      const data = { name: 'John', email: 'john@example.com' }
      const rules = {
        name: { required: true, minLength: 2 },
        email: { required: true, email: true }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(0)
    })

    it('accepts valid email addresses', () => {
      const data = { email: 'user@domain.com' }
      const rules = {
        email: { email: true }
      }

      const errors = validateFormFields(data, rules)

      expect(errors).toHaveLength(0)
    })
  })

  describe('formatErrorForDisplay', () => {
    it('formats basic error message', () => {
      const error: ParsedError = {
        type: 'unknown',
        message: 'Something went wrong'
      }

      const formatted = formatErrorForDisplay(error)

      expect(formatted).toBe('Something went wrong')
    })

    it('includes field errors in formatted output', () => {
      const error: ParsedError = {
        type: 'validation',
        message: 'Validation failed',
        fieldErrors: [{ field: 'email', message: 'Invalid email' }]
      }

      const formatted = formatErrorForDisplay(error)

      expect(formatted).toContain('Validation failed')
      expect(formatted).toContain('email: Invalid email')
    })

    it('includes multiple field errors', () => {
      const error: ParsedError = {
        type: 'validation',
        message: 'Multiple errors',
        fieldErrors: [
          { field: 'name', message: 'Required' },
          { field: 'email', message: 'Invalid' }
        ]
      }

      const formatted = formatErrorForDisplay(error)

      expect(formatted).toContain('name: Required')
      expect(formatted).toContain('email: Invalid')
    })

    it('includes suggestion when present', () => {
      const error: ParsedError = {
        type: 'unknown',
        message: 'Error occurred',
        suggestion: 'Try again later'
      }

      const formatted = formatErrorForDisplay(error)

      expect(formatted).toContain('Try again later')
      expect(formatted).toContain('💡')
    })

    it('formats complete error with all fields', () => {
      const error: ParsedError = {
        type: 'constraint',
        message: 'Constraint violation',
        fieldErrors: [{ field: 'id', message: 'Duplicate' }],
        suggestion: 'Use a unique ID'
      }

      const formatted = formatErrorForDisplay(error)

      expect(formatted).toContain('Constraint violation')
      expect(formatted).toContain('id: Duplicate')
      expect(formatted).toContain('Use a unique ID')
    })
  })
})
