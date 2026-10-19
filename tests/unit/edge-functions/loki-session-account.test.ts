import { describe, expect, it } from 'vitest'
import {
  lokiSessionOwnerFilter,
  resolveLokiSessionAccount
} from '../../../supabase/functions/_shared/loki-session-account.ts'

describe('resolveLokiSessionAccount', () => {
  it('sends a batch session only as the account that minted it', () => {
    expect(
      resolveLokiSessionAccount(
        { user_id: null, session_id: 'stored-session' },
        'scraper',
        { userId: 'scraper', sessionId: 'batch-session' }
      )
    ).toEqual({
      userId: 'scraper',
      sessionId: 'batch-session',
      overrodeLegacyRow: false
    })
  })

  it('never pairs a leader row user_id with the scraper batch session', () => {
    // The row's own user_id has no secret here, so it is never the request account.
    const account = resolveLokiSessionAccount(
      { user_id: 'leader-user', session_id: 'leader-session' },
      'scraper',
      { userId: 'scraper', sessionId: 'batch-session' }
    )
    expect(account).toEqual({
      userId: 'scraper',
      sessionId: 'batch-session',
      overrodeLegacyRow: true
    })

    // Without a scraper id there is no account that may send either session.
    expect(
      resolveLokiSessionAccount(
        { user_id: 'leader-user', session_id: 'leader-session' },
        null,
        { userId: 'scraper', sessionId: 'batch-session' }
      )
    ).toEqual({ userId: null, sessionId: '', overrodeLegacyRow: false })
  })

  it('ignores a batch session minted for a different account', () => {
    expect(
      resolveLokiSessionAccount(
        { user_id: null, session_id: 'stored-session' },
        'scraper',
        { userId: 'other-account', sessionId: 'other-session' }
      )
    ).toEqual({
      userId: 'scraper',
      sessionId: 'stored-session',
      overrodeLegacyRow: false
    })
    expect(
      resolveLokiSessionAccount(
        { user_id: 'leader-user', session_id: 'leader-session' },
        'scraper',
        { userId: 'leader-user', sessionId: 'leader-batch-session' }
      )
    ).toEqual({ userId: 'scraper', sessionId: '', overrodeLegacyRow: true })
  })

  it('limits session mirror writes to rows the minting account owns', () => {
    expect(lokiSessionOwnerFilter('scraper')).toBe(
      'user_id.is.null,user_id.eq.scraper'
    )
  })
})
