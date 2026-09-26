/** Logs in development only; errors always log. */
import { sanitizeLogValue } from './logging-sanitizer'

const isDevelopment = process.env.NODE_ENV === 'development'
const isDebugEnabled = process.env.NEXT_PUBLIC_DEBUG === 'true'
const MAX_REPEAT_DEFAULT = 3
const maxRepeat = Number.parseInt(
  process.env.NEXT_PUBLIC_LOG_MAX_REPEATS || '',
  10
)
const MAX_REPEAT_THRESHOLD =
  Number.isFinite(maxRepeat) && maxRepeat >= 0 ? maxRepeat : MAX_REPEAT_DEFAULT

const logCounts = new Map<string, number>()
const sanitizeArgs = (args: LogArgs): LogArgs =>
  args.map((arg) => sanitizeLogValue(arg))

const buildKey = (level: string, args: LogArgs): string => {
  try {
    return `${level}:${args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (typeof arg === 'number' || typeof arg === 'boolean')
          return String(arg)
        if (arg instanceof Error) return `${arg.name}:${arg.message}`
        return JSON.stringify(arg)
      })
      .join('|')}`
  } catch (error) {
    return `${level}:unserializable`
  }
}

const shouldLog = (level: string, args: LogArgs): boolean => {
  if (!isDevelopment) return false
  if (MAX_REPEAT_THRESHOLD === 0) return false
  if (MAX_REPEAT_THRESHOLD === Infinity) return true

  const key = buildKey(level, args)
  const currentCount = logCounts.get(key) ?? 0
  if (currentCount >= MAX_REPEAT_THRESHOLD) {
    return false
  }
  logCounts.set(key, currentCount + 1)
  return true
}

type LogArgs = unknown[]

export const legacyConsoleLogger = {
  log: (...args: LogArgs): void => {
    const safeArgs = sanitizeArgs(args)
    if (shouldLog('log', safeArgs)) {
      console.log(...safeArgs)
    }
  },
  warn: (...args: LogArgs): void => {
    const safeArgs = sanitizeArgs(args)
    if (shouldLog('warn', safeArgs)) {
      console.warn(...safeArgs)
    }
  },
  error: (...args: LogArgs): void => {
    console.error(...sanitizeArgs(args))
  },
  debug: (...args: LogArgs): void => {
    if (isDevelopment || isDebugEnabled) {
      console.debug(...sanitizeArgs(args))
    }
  },
  info: (...args: LogArgs): void => {
    const safeArgs = sanitizeArgs(args)
    if (shouldLog('info', safeArgs)) {
      console.info(...safeArgs)
    }
  },
  time: (label: string): void => {
    if (shouldLog('time', [label])) {
      console.time(label)
    }
  },
  timeEnd: (label: string): void => {
    if (shouldLog('timeEnd', [label])) {
      console.timeEnd(label)
    }
  },
  group: (...args: LogArgs): void => {
    const safeArgs = sanitizeArgs(args)
    if (shouldLog('group', safeArgs)) {
      console.group(...safeArgs)
    }
  },
  groupEnd: (): void => {
    if (isDevelopment) {
      console.groupEnd()
    }
  },
  table: (data: unknown): void => {
    const safeData = sanitizeLogValue(data)
    if (shouldLog('table', [safeData])) {
      console.table(safeData)
    }
  }
}
