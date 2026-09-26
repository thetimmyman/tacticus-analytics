import {
  createError,
  formatErrorForUser,
  getVersionInfo,
  type ErrorContext
} from '@tacticus/app-core/error-handler'
import { Errors } from '@/app/lib/errors/AppError'

type ErrorCodeKey = Parameters<typeof createError>[0]

/** Returns `never` so control-flow analysis treats it as a `throw`. */
export function throwUserFacingError(
  code: ErrorCodeKey,
  message: string,
  status: number,
  context: Partial<ErrorContext> & { component: string; action: string },
  opts?: { cause?: unknown; extraBody?: Record<string, unknown> }
): never {
  const enhancedError = createError(code, message, context, opts?.cause)
  const userError = formatErrorForUser(enhancedError)
  const version = getVersionInfo()
  throw Errors.fromResponse(status, {
    error: userError.message,
    code: userError.code,
    version: version.version,
    supportMessage: userError.supportMessage,
    ...(opts?.extraBody ?? {})
  })
}
