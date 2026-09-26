export type LogArgs = unknown[]

export interface Logger {
  debug: (...args: LogArgs) => void
  info: (...args: LogArgs) => void
  warn: (...args: LogArgs) => void
  error: (...args: LogArgs) => void
}

export const logger: Logger = {
  debug: (...args) => {
    if (process.env.NODE_ENV === 'development') console.debug(...args)
  },
  info: (...args) => {
    if (process.env.NODE_ENV === 'development') console.info(...args)
  },
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
}
