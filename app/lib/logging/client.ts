// Browser logger: only error/fatal log in production, so ids, guild codes and PostgREST/RLS
// details never reach the console. Server code uses the pino logger in `@/app/lib/logging`.

import {
  redactObservabilityText,
  sanitizeObservabilityValue
} from '@/app/lib/monitoring/sentry-privacy'

type LogObject = Record<string, unknown>
type LogArg = LogObject | string
type Level = 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal'

export interface ClientLogger {
  info: (objOrMsg: LogArg, msg?: string) => void
  warn: (objOrMsg: LogArg, msg?: string) => void
  error: (objOrMsg: LogArg, msg?: string) => void
  debug: (objOrMsg: LogArg, msg?: string) => void
  trace: (objOrMsg: LogArg, msg?: string) => void
  fatal: (objOrMsg: LogArg, msg?: string) => void
  child: (bindings: LogObject) => ClientLogger
}

const isDevelopment =
  typeof process !== 'undefined' && process.env.NODE_ENV === 'development'

const CONSOLE_METHOD: Record<
  Level,
  'log' | 'info' | 'warn' | 'error' | 'debug'
> = {
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
  debug: 'debug',
  trace: 'debug'
}

const ALWAYS_LOG: ReadonlySet<Level> = new Set(['error', 'fatal'])

function emit(
  level: Level,
  component: string,
  bindings: LogObject,
  objOrMsg: LogArg,
  msg: string | undefined
): void {
  if (!isDevelopment && !ALWAYS_LOG.has(level)) return
  const fn = console[CONSOLE_METHOD[level]] ?? console.log
  const tag = `[${component}]`
  if (typeof objOrMsg === 'string') {
    const safeValue = redactObservabilityText(objOrMsg)
    if (msg !== undefined) fn(tag, safeValue, redactObservabilityText(msg))
    else fn(tag, safeValue)
    return
  }
  const merged =
    Object.keys(bindings).length > 0 ? { ...bindings, ...objOrMsg } : objOrMsg
  const safeMerged = sanitizeObservabilityValue(merged)
  if (msg !== undefined) fn(tag, redactObservabilityText(msg), safeMerged)
  else fn(tag, safeMerged)
}

function build(component: string, bindings: LogObject): ClientLogger {
  const make =
    (level: Level) =>
    (objOrMsg: LogArg, msg?: string): void => {
      emit(level, component, bindings, objOrMsg, msg)
    }
  return {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    trace: make('trace'),
    fatal: make('fatal'),
    child: (extra: LogObject) => build(component, { ...bindings, ...extra })
  }
}

export function createComponentLogger(
  component: string,
  context?: LogObject
): ClientLogger {
  return build(component, context ?? {})
}
