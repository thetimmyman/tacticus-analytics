import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV_KEYS = [
  'NODE_ENV',
  'NEXT_PUBLIC_DEBUG',
  'NEXT_PUBLIC_LOG_MAX_REPEATS'
]

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
)

const restoreEnv = () => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  })
}

const applyEnv = (env: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  })
}

const loadLogger = async (
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>
) => {
  restoreEnv()
  applyEnv(env)
  vi.resetModules()
  return await import('@tacticus/app-core/logger')
}

describe('logger', () => {
  afterEach(() => {
    restoreEnv()
    vi.restoreAllMocks()
  })

  it('limits repeated logs in development', async () => {
    const { legacyConsoleLogger: logger } = await loadLogger({
      NODE_ENV: 'development',
      NEXT_PUBLIC_LOG_MAX_REPEATS: '2'
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.log('repeat')
    logger.log('repeat')
    logger.log('repeat')

    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('does not log info/warn/log in production', async () => {
    const { legacyConsoleLogger: logger } = await loadLogger({
      NODE_ENV: 'production',
      NEXT_PUBLIC_LOG_MAX_REPEATS: '3'
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logger.log('quiet')
    logger.warn('quiet')
    logger.info('quiet')

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('always logs errors', async () => {
    const { legacyConsoleLogger: logger } = await loadLogger({
      NODE_ENV: 'production'
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logger.error('boom')

    expect(errorSpy).toHaveBeenCalledWith('boom')
  })

  it('logs debug when debug flag is enabled', async () => {
    const { legacyConsoleLogger: logger } = await loadLogger({
      NODE_ENV: 'production',
      NEXT_PUBLIC_DEBUG: 'true'
    })

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    logger.debug('details')

    expect(debugSpy).toHaveBeenCalledWith('details')
  })

  it('suppresses debug when not in development and debug flag is off', async () => {
    const { legacyConsoleLogger: logger } = await loadLogger({
      NODE_ENV: 'production',
      NEXT_PUBLIC_DEBUG: 'false'
    })

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    logger.debug('details')

    expect(debugSpy).not.toHaveBeenCalled()
  })
})
