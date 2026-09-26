export interface ParsedError extends Error {
  code?: string
  statusCode?: number
  details?: unknown
}

export interface DatabaseError extends ParsedError {
  code: string
  details?: {
    table?: string
    operation?: string
    constraint?: string
  }
}

export interface ApiError extends ParsedError {
  statusCode: number
  endpoint?: string
  method?: string
}

export interface ValidationError extends ParsedError {
  fields?: Record<string, string[]>
}

export interface AuthError extends ParsedError {
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'SESSION_EXPIRED' | 'INVALID_CREDENTIALS'
}

export function isParsedError(error: unknown): error is ParsedError {
  return error instanceof Error && 'code' in error
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return (
    isParsedError(error) && typeof (error as DatabaseError).code === 'string'
  )
}

export function isApiError(error: unknown): error is ApiError {
  return isParsedError(error) && 'statusCode' in error
}

export function isAuthError(error: unknown): error is AuthError {
  return (
    isParsedError(error) &&
    [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'SESSION_EXPIRED',
      'INVALID_CREDENTIALS'
    ].includes((error as AuthError).code || '')
  )
}

export function parseError(error: unknown): ParsedError {
  if (isParsedError(error)) {
    return error
  }

  if (error instanceof Error) {
    return {
      ...error,
      name: error.name,
      message: error.message,
      stack: error.stack
    } as ParsedError
  }

  if (typeof error === 'string') {
    return new Error(error) as ParsedError
  }

  return new Error('An unknown error occurred') as ParsedError
}
