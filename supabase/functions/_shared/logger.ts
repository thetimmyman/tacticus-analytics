export interface LogContext {
  correlationId?: string
  guildCode?: string
  module?: string
  phase?: string
  [key: string]: unknown
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  child(context: Partial<LogContext>): Logger
}

const formatTimestamp = (): string => new Date().toISOString()

const formatArgs = (
  level: string,
  context: LogContext | undefined,
  args: unknown[]
): string => {
  const ts = formatTimestamp()
  const ctxLabel = context?.module || context?.guildCode || ''
  const levelStr = level.toUpperCase().padEnd(5)

  const prefix = ctxLabel
    ? `[${ts}][${levelStr}][${ctxLabel}]`
    : `[${ts}][${levelStr}]`

  const parts = args.map((arg) => {
    if (arg === null) return 'null'
    if (arg === undefined) return 'undefined'
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }
    return String(arg)
  })

  return `${prefix} ${parts.join(' ')}`
}

export const createLogger = (context?: LogContext): Logger => {
  const ctx = context || {}

  return {
    debug: (...args) => console.log(formatArgs('debug', ctx, args)),
    info: (...args) => console.log(formatArgs('info', ctx, args)),
    warn: (...args) => console.warn(formatArgs('warn', ctx, args)),
    error: (...args) => console.error(formatArgs('error', ctx, args)),
    child: (childCtx) => createLogger({ ...ctx, ...childCtx })
  }
}

export const logger = createLogger()
