import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino'
import {
  PII_LOG_REDACTION_PATHS,
  sanitizeLogUrl,
  sanitizeLogValue
} from '@tacticus/app-core/logging-sanitizer'
import { isSafeRequestId } from './correlation-id'

export {
  redactPiiText,
  sanitizeLogValue
} from '@tacticus/app-core/logging-sanitizer'

const LOG_LEVEL =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'
const IS_TEST = process.env.NODE_ENV === 'test'

const BASE_CONTEXT = {
  service: 'tacticus-analytics',
  version: process.env.npm_package_version || '0.0.0'
}

export function createLoggerOptions(): LoggerOptions {
  const options: LoggerOptions = {
    level: LOG_LEVEL,
    base: {
      ...BASE_CONTEXT,
      env: process.env.NODE_ENV || 'development'
    },
    redact: [
      '*.client_secret',
      'client_secret',
      '*.clientSecret',
      'clientSecret',
      ...PII_LOG_REDACTION_PATHS
    ],
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label })
    },
    hooks: {
      logMethod(args, method) {
        const safeMethod = method as (...values: unknown[]) => void
        safeMethod.apply(
          this,
          args.map((arg) => sanitizeLogValue(arg))
        )
      }
    },
    // Error message/stack/cause are non-enumerable; without this `err` logs as {}.
    serializers: {
      err: (error) => sanitizeLogValue(pino.stdSerializers.err(error))
    }
  }

  if (IS_DEVELOPMENT && typeof window === 'undefined') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,service,version,env'
      }
    }
  }

  if (IS_TEST) {
    options.level = 'silent'
  }

  return options
}

export const logger: PinoLogger = pino(createLoggerOptions())

export interface RequestContext {
  requestId: string
  method?: string
  url?: string
  userId?: string
  guildId?: string
  clusterId?: string
  [key: string]: unknown
}

export function createRequestLogger(context: RequestContext): PinoLogger {
  return logger.child(sanitizeLogValue(context) as RequestContext)
}

export function createComponentLogger(
  component: string,
  context?: Record<string, unknown>
): PinoLogger {
  return logger.child(
    sanitizeLogValue({ component, ...context }) as Record<string, unknown>
  )
}

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `req_${crypto.randomUUID()}`
  }
  // UUID-shaped so correlation-id validation stays fail-closed.
  return `req_${'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
    /[xy]/gu,
    (token) => {
      const random = Math.floor(Math.random() * 16)
      const nibble = token === 'x' ? random : (random & 0x3) | 0x8
      return nibble.toString(16)
    }
  )}`
}

export function resolveRequestId(candidate?: string | null): string {
  return isSafeRequestId(candidate) ? candidate : generateRequestId()
}

export function sanitizeForLogging<T extends Record<string, unknown>>(
  obj: T,
  sensitiveKeys: string[] = [
    'password',
    'token',
    'apiKey',
    'secret',
    'authorization',
    'cookie'
  ]
): T {
  const sanitized = { ...obj }

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
      sanitized[key as keyof T] = '[REDACTED]' as T[keyof T]
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key as keyof T] = sanitizeForLogging(
        sanitized[key] as Record<string, unknown>,
        sensitiveKeys
      ) as T[keyof T]
    }
  }

  return sanitized
}

export function logApiCall(
  log: PinoLogger,
  method: string,
  url: string,
  status: number,
  durationMs: number,
  context?: Record<string, unknown>
): void {
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  const safeUrl = sanitizeLogUrl(url)

  log[level](
    {
      method,
      url: safeUrl,
      status,
      durationMs,
      category: 'api',
      ...context
    },
    `${method} ${safeUrl} ${status} - ${durationMs}ms`
  )
}

export function logError(
  log: PinoLogger,
  error: unknown,
  message: string,
  context?: Record<string, unknown>
): void {
  if (error instanceof Error) {
    log.error(
      {
        err: error,
        ...context
      },
      message
    )
  } else {
    log.error(
      {
        err: error,
        ...context
      },
      message
    )
  }
}

export type { Logger as PinoLogger } from 'pino'
