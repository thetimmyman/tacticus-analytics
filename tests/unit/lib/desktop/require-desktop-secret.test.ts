import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { AppError } from '@/app/lib/errors/AppError'
import { requireDesktopApiSecret } from '@/app/lib/desktop/require-desktop-secret'
import { POST as normalizeRosterPost } from '@/app/api/desktop/normalize-roster/route'

const makeReq = (authorization?: string) =>
  new NextRequest('http://127.0.0.1:1234/api/desktop/normalize-roster', {
    method: 'POST',
    headers: authorization ? { authorization } : {}
  })

describe('requireDesktopApiSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts DESKTOP_API_SECRET and rejects CRON_SECRET when DESKTOP_API_SECRET is configured', () => {
    const desktopSecret = randomBytes(24).toString('hex')
    const cronSecret = randomBytes(24).toString('hex')
    vi.stubEnv('DESKTOP_API_SECRET', desktopSecret)
    vi.stubEnv('CRON_SECRET', cronSecret)

    expect(() =>
      requireDesktopApiSecret(makeReq(`Bearer ${desktopSecret}`))
    ).not.toThrow()
    expect(() =>
      requireDesktopApiSecret(makeReq(`Bearer ${cronSecret}`))
    ).toThrow(AppError)

    try {
      requireDesktopApiSecret(makeReq(`Bearer ${cronSecret}`))
    } catch (error) {
      expect((error as AppError).statusCode).toBe(401)
    }
  })

  it('falls back to CRON_SECRET when DESKTOP_API_SECRET is unset', () => {
    const cronSecret = randomBytes(24).toString('hex')
    vi.stubEnv('DESKTOP_API_SECRET', '')
    vi.stubEnv('CRON_SECRET', cronSecret)

    expect(() =>
      requireDesktopApiSecret(makeReq(`Bearer ${cronSecret}`))
    ).not.toThrow()
    expect(() =>
      requireDesktopApiSecret(makeReq('Bearer wrong-secret'))
    ).toThrow(AppError)
  })

  it('fails closed with 500 when neither DESKTOP_API_SECRET nor CRON_SECRET is set', () => {
    vi.stubEnv('DESKTOP_API_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')

    let caught: unknown
    try {
      requireDesktopApiSecret(makeReq('Bearer anything'))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).statusCode).toBe(500)
  })

  it('rejects multi-byte bearer headers with 401 instead of 500', () => {
    vi.stubEnv('DESKTOP_API_SECRET', 'ascii-secret')

    let caught: unknown
    try {
      requireDesktopApiSecret(makeReq('Bearer é'))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).statusCode).toBe(401)
  })

  it('enforces DESKTOP_API_SECRET precedence on /api/desktop/normalize-roster', async () => {
    const desktopSecret = randomBytes(24).toString('hex')
    const cronSecret = randomBytes(24).toString('hex')
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    vi.stubEnv('DESKTOP_API_SECRET', desktopSecret)
    vi.stubEnv('CRON_SECRET', cronSecret)

    expect(
      (await normalizeRosterPost(makeReq(`Bearer ${cronSecret}`))).status
    ).toBe(401)
    expect(
      (await normalizeRosterPost(makeReq(`Bearer ${desktopSecret}`))).status
    ).toBe(404)

    vi.stubEnv('DESKTOP_API_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
    expect(
      (await normalizeRosterPost(makeReq(`Bearer ${desktopSecret}`))).status
    ).toBe(500)
  })
})
