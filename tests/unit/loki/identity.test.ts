import { describe, expect, it } from 'vitest'
import { resolveLokiIdentity } from '@/app/lib/loki/identity'

describe('resolveLokiIdentity', () => {
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

  it('never sends a row user_id: without a scraper id there is no account to send as', () => {
    // No secret exists for a guild's own user_id, so pairing it with any session is a mismatched login.
    expect(
      resolveLokiIdentity(
        { user_id: 'leader-user', session_id: 'scraper-session' },
        { userId: '' }
      )
    ).toEqual({
      userId: null,
      sessionId: '',
      overrodeLegacyRow: false
    })
    expect(resolveLokiIdentity(null, { userId: null })).toEqual({
      userId: null,
      sessionId: '',
      overrodeLegacyRow: false
    })
  })
})
