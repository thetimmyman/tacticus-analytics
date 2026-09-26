import { describe, expect, it } from 'vitest'
import { resolveLokiIdentity } from '@/app/lib/loki/identity'

describe('resolveLokiIdentity (PS-699)', () => {
  it('env scraper id wins and keeps the stored session when the row has no user_id', () => {
    expect(
      resolveLokiIdentity(
        { user_id: null, session_id: 'shared-session' },
        { userId: 'scraper' }
      )
    ).toEqual({
      userId: 'scraper',
      sessionId: 'shared-session',
      overrodeLegacyRow: false
    })
  })

  it('a legacy row user_id is overridden AND its session is discarded (forces CONNECT)', () => {
    expect(
      resolveLokiIdentity(
        { user_id: 'legacy-player-id', session_id: 'legacy-session' },
        { userId: 'scraper' }
      )
    ).toEqual({ userId: 'scraper', sessionId: '', overrodeLegacyRow: true })
  })

  it('a row user_id equal to the scraper id is not an override', () => {
    expect(
      resolveLokiIdentity(
        { user_id: 'scraper', session_id: 's1' },
        { userId: 'scraper' }
      )
    ).toEqual({ userId: 'scraper', sessionId: 's1', overrodeLegacyRow: false })
  })

  it('falls back to the row identity only when no env scraper id exists', () => {
    expect(
      resolveLokiIdentity(
        { user_id: 'row-user', session_id: 'row-session' },
        { userId: '' }
      )
    ).toEqual({
      userId: 'row-user',
      sessionId: 'row-session',
      overrodeLegacyRow: false
    })
    expect(resolveLokiIdentity(null, { userId: null })).toEqual({
      userId: null,
      sessionId: '',
      overrodeLegacyRow: false
    })
  })
})
