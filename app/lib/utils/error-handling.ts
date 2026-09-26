export interface FieldError {
  field: string
  message: string
  code?: string
}

export interface ParsedError {
  type: 'validation' | 'permission' | 'constraint' | 'network' | 'unknown'
  message: string
  fieldErrors?: FieldError[]
  details?: string
  suggestion?: string
}

export function parseSupabaseError(error: Error | unknown): ParsedError {
  if (!error) {
    return {
      type: 'unknown',
      message: 'An unknown error occurred',
      suggestion: 'Please try again or contact support'
    }
  }

  const errorObj =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {}
  const errorCode =
    typeof errorObj.code === 'string'
      ? errorObj.code
      : typeof errorObj.error_code === 'string'
        ? errorObj.error_code
        : ''
  const errorMessage =
    typeof errorObj.message === 'string'
      ? errorObj.message
      : typeof errorObj.error_description === 'string'
        ? errorObj.error_description
        : 'Unknown error'
  const errorDetails =
    typeof errorObj.details === 'string'
      ? errorObj.details
      : typeof errorObj.error_details === 'string'
        ? errorObj.error_details
        : ''
  const errorHint = typeof errorObj.hint === 'string' ? errorObj.hint : ''

  if (errorCode === '42501' || errorMessage.includes('policy')) {
    return parseRLSError(error)
  }

  if (errorCode.startsWith('23')) {
    return parseConstraintError(error)
  }

  if (errorCode === '22P02' || errorCode === '22001') {
    return parseInputError(error)
  }

  if (errorCode === '28P01' || errorCode === '28000') {
    return {
      type: 'permission',
      message: 'Authentication failed',
      details: errorMessage,
      suggestion: 'Please log in again or check your credentials'
    }
  }

  // @ts-expect-error -- intentionally accessing optional error fields for logging
  if (error.name === 'FetchError' || errorMessage.includes('fetch')) {
    return {
      type: 'network',
      message: 'Network connection error',
      details: 'Unable to connect to the server',
      suggestion: 'Please check your internet connection and try again'
    }
  }

  return {
    type: 'unknown',
    message: errorMessage,
    details: errorDetails || errorHint,
    suggestion: 'Please review your input and try again'
  }
}

function parseRLSError(error: Error | unknown): ParsedError {
  const errorObj =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {}
  const message = typeof errorObj.message === 'string' ? errorObj.message : ''
  const details = typeof errorObj.details === 'string' ? errorObj.details : ''

  if (message.includes('new row violates row-level security')) {
    const table = extractTableName(message)
    return {
      type: 'permission',
      message: `You don't have permission to create records in ${table || 'this table'}`,
      details:
        'This could be due to missing authentication or insufficient privileges',
      suggestion: 'Please ensure you are logged in with the correct account'
    }
  }

  if (message.includes('update') && message.includes('row-level security')) {
    return {
      type: 'permission',
      message: "You don't have permission to update this record",
      details:
        'You may only update records you own or have been granted access to',
      suggestion: "Check if you're logged in with the correct account"
    }
  }

  if (message.includes('delete') && message.includes('row-level security')) {
    return {
      type: 'permission',
      message: "You don't have permission to delete this record",
      details: 'Deletion may be restricted to owners or administrators',
      suggestion: 'Contact an administrator if you believe this is an error'
    }
  }

  return {
    type: 'permission',
    message: 'Permission denied',
    details: details || message,
    suggestion: 'You may not have the required privileges for this operation'
  }
}

function parseConstraintError(error: Error | unknown): ParsedError {
  const errorObj =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {}
  const errorCode = typeof errorObj.code === 'string' ? errorObj.code : ''
  const message = typeof errorObj.message === 'string' ? errorObj.message : ''
  const constraint =
    typeof errorObj.constraint === 'string'
      ? errorObj.constraint
      : extractConstraintName(message)

  if (errorCode === '23505') {
    const field = extractFieldFromUniqueConstraint(constraint ?? '', message)
    return {
      type: 'constraint',
      message: `This ${field || 'value'} already exists`,
      fieldErrors: field
        ? [{ field, message: 'This value is already taken' }]
        : undefined,
      details: `Duplicate value violates unique constraint`,
      suggestion: `Please choose a different ${field || 'value'}`
    }
  }

  if (errorCode === '23503') {
    const field = extractFieldFromForeignKey(constraint ?? '', message)
    return {
      type: 'constraint',
      message: `Invalid reference: ${field || 'related record'} doesn't exist`,
      fieldErrors: field
        ? [{ field, message: 'Invalid reference' }]
        : undefined,
      details: 'The referenced record does not exist',
      suggestion: 'Please select a valid option'
    }
  }

  if (errorCode === '23514') {
    return parseCheckConstraint(
      constraint ?? '',
      message,
      typeof errorObj.details === 'string' ? errorObj.details : undefined
    )
  }

  if (errorCode === '23502') {
    const field = extractFieldFromNotNull(message)
    return {
      type: 'validation',
      message: `Required field missing: ${field || 'unknown'}`,
      fieldErrors: field
        ? [{ field, message: 'This field is required' }]
        : undefined,
      details: 'A required field was not provided',
      suggestion: 'Please fill in all required fields'
    }
  }

  return {
    type: 'constraint',
    message: 'Database constraint violation',
    details: message,
    suggestion: 'Please check your input values'
  }
}

function parseInputError(error: Error | unknown): ParsedError {
  const errorObj =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {}
  const message = typeof errorObj.message === 'string' ? errorObj.message : ''

  if (errorObj.code === '22001') {
    const field = extractFieldFromMessage(message)
    return {
      type: 'validation',
      message: 'Input too long',
      fieldErrors: field
        ? [{ field, message: 'Value exceeds maximum length' }]
        : undefined,
      details: message,
      suggestion: 'Please shorten your input'
    }
  }

  if (errorObj.code === '22P02') {
    return {
      type: 'validation',
      message: 'Invalid input format',
      details: message,
      suggestion: 'Please check the format of your input'
    }
  }

  return {
    type: 'validation',
    message: 'Invalid input',
    details: message,
    suggestion: 'Please review your input values'
  }
}

function parseCheckConstraint(
  constraint: string,
  message: string,
  details?: string
): ParsedError {
  if (constraint === 'check_token_thresholds') {
    return {
      type: 'validation',
      message: 'Invalid token threshold values',
      fieldErrors: [
        {
          field: 'token_offender_threshold',
          message: 'Must be between 1 and 10'
        },
        { field: 'token_abuser_threshold', message: 'Must be between 1 and 10' }
      ],
      details: 'Token thresholds must be between 1 and 10',
      suggestion: 'Please enter values between 1 and 10'
    }
  }

  return {
    type: 'constraint',
    message: `Constraint violation: ${constraint || 'unknown'}`,
    details: details || message,
    suggestion: 'Please check your input values'
  }
}

function extractTableName(message: string): string | null {
  const match =
    message.match(/relation "([^"]+)"/i) ||
    message.match(/table "([^"]+)"/i) ||
    message.match(/on table (\w+)/i)
  return match?.[1] ?? null
}

function extractConstraintName(message: string): string | null {
  const match = message.match(/constraint "([^"]+)"/i)
  return match?.[1] ?? null
}

function extractFieldFromUniqueConstraint(
  constraint: string,
  message: string
): string | null {
  // "users_email_key" -> "email"
  if (constraint) {
    const parts = constraint.split('_')
    if (parts.length >= 2) {
      return parts.slice(1, -1).join('_')
    }
  }

  const match = message.match(/Key \(([^)]+)\)/i)
  return match?.[1] ?? null
}

function extractFieldFromForeignKey(
  constraint: string,
  message: string
): string | null {
  if (constraint) {
    // "orders_user_id_fkey" -> "user_id"
    const parts = constraint.split('_')
    if (parts.length >= 3 && parts[parts.length - 1] === 'fkey') {
      return parts.slice(1, -1).join('_')
    }
  }

  const match = message.match(/Key \(([^)]+)\)/i)
  return match?.[1] ?? null
}

function extractFieldFromNotNull(message: string): string | null {
  const match = message.match(/column "([^"]+)"/i)
  return match?.[1] ?? null
}

function extractFieldFromMessage(message: string): string | null {
  const match =
    message.match(/column "([^"]+)"/i) || message.match(/field "([^"]+)"/i)
  return match?.[1] ?? null
}

export function validateFormFields(
  data: Record<string, unknown>,
  rules: Record<
    string,
    {
      required?: boolean
      requiredMessage?: string
      minLength?: number
      minLengthMessage?: string
      maxLength?: number
      maxLengthMessage?: string
      pattern?: RegExp
      patternMessage?: string
      email?: boolean
      validate?: (value: never, data: Record<string, unknown>) => string | null
    }
  >
): FieldError[] {
  const errors: FieldError[] = []

  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = data[field]

    if (fieldRules.required && !value) {
      errors.push({
        field,
        message: fieldRules.requiredMessage || 'This field is required',
        code: 'required'
      })
      continue
    }

    if (
      fieldRules.minLength &&
      typeof value === 'string' &&
      value.length < fieldRules.minLength
    ) {
      errors.push({
        field,
        message:
          fieldRules.minLengthMessage ||
          `Minimum ${fieldRules.minLength} characters required`,
        code: 'minLength'
      })
    }

    if (
      fieldRules.maxLength &&
      typeof value === 'string' &&
      value.length > fieldRules.maxLength
    ) {
      errors.push({
        field,
        message:
          fieldRules.maxLengthMessage ||
          `Maximum ${fieldRules.maxLength} characters allowed`,
        code: 'maxLength'
      })
    }

    if (
      fieldRules.pattern &&
      typeof value === 'string' &&
      !fieldRules.pattern.test(value)
    ) {
      errors.push({
        field,
        message: fieldRules.patternMessage || 'Invalid format',
        code: 'pattern'
      })
    }

    if (fieldRules.email && typeof value === 'string' && !isValidEmail(value)) {
      errors.push({
        field,
        message: 'Please enter a valid email address',
        code: 'email'
      })
    }

    if (fieldRules.validate && value) {
      const error = fieldRules.validate(value as never, data)
      if (error) {
        errors.push({
          field,
          message: error,
          code: 'custom'
        })
      }
    }
  }

  return errors
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function formatErrorForDisplay(error: ParsedError): string {
  let display = error.message

  if (error.fieldErrors && error.fieldErrors.length > 0) {
    const fieldMessages = error.fieldErrors
      .map((fe) => `${fe.field}: ${fe.message}`)
      .join(', ')
    display += ` (${fieldMessages})`
  }

  if (error.suggestion) {
    display += `\n\n💡 ${error.suggestion}`
  }

  return display
}
