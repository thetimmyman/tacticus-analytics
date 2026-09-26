import {
  isHistoricalSeason,
  normalizeRaidPayload,
  parseLatestSeason,
  parseLiveRaidSeason,
  parseSyncRequestContext
} from '../../../supabase/functions/sync-modular-workflow/request-context.ts'

describe('sync request context', () => {
  it('normalizes request fields and accepts both notification-skip flags', () => {
    expect(
      parseSyncRequestContext(
        {
          guild_code: ' abc ',
          correlation_id: 'trace-1',
          season: 91,
          dr_mode: true,
          preserve_sync_settings: true,
          fresh_session_id: ' session ',
          api_key: ' key '
        },
        () => 'generated'
      )
    ).toEqual({
      guildCode: 'ABC',
      correlationId: 'trace-1',
      requestedSeason: 91,
      skipNotifications: true,
      preserveSyncSettings: true,
      freshSessionId: 'session',
      explicitApiKey: 'key'
    })
  })

  it('uses safe defaults for malformed bodies', () => {
    expect(parseSyncRequestContext(null, () => 'generated')).toEqual({
      guildCode: '',
      correlationId: 'generated',
      requestedSeason: null,
      skipNotifications: false,
      preserveSyncSettings: false,
      freshSessionId: null,
      explicitApiKey: null
    })
  })

  it.each(['106', {}, false])(
    'does not turn invalid explicit season %j into a live sync',
    (season) => {
      expect(
        parseSyncRequestContext({ season }, () => 'id').requestedSeason
      ).toBeNaN()
    }
  )

  it.each(['92suffix', '', ' ', 0, -1, 2.5, true, [], {}])(
    'rejects malformed canonical season %j',
    (value) => {
      expect(parseLatestSeason(value)).toBeNull()
    }
  )

  it('parses and classifies seasons without hardcoded fallbacks', () => {
    expect(parseLatestSeason('92')).toBe(92)
    expect(parseLatestSeason('not-a-season')).toBeNull()
    expect(parseLatestSeason(null)).toBeNull()
    expect(isHistoricalSeason(91, 92)).toBe(true)
    expect(isHistoricalSeason(92, 92)).toBe(false)
    expect(isHistoricalSeason(91, null)).toBe(false)
  })

  it.each([
    [{ season: 111 }, 111],
    [{ currentSeason: '111' }, 111],
    [{ body: { season: 111, entries: [] } }, 111],
    [{ entries: [] }, null],
    [{ season: '111junk' }, null]
  ])('parses the live guildRaid season %j', (payload, expected) => {
    expect(parseLiveRaidSeason(payload)).toBe(expected)
  })

  it('classifies a stored previous season as historical against the live feed', () => {
    const currentSeason = parseLiveRaidSeason({ season: 111 })
    expect(isHistoricalSeason(110, currentSeason)).toBe(true)
  })

  it('rejects rollover between explicit-season pre-read and final live payload', () => {
    const result = normalizeRaidPayload(
      { season: 112, entries: [{ id: 'late-feed' }] },
      { isHistorical: false, requestedSeason: 111 }
    )
    expect(result.valid).toBe(false)
  })

  it('normalizes nested live entries and season metadata', () => {
    expect(
      normalizeRaidPayload(
        { body: { season: '111', entries: [{ id: 'nested' }] } },
        { isHistorical: false, requestedSeason: null }
      )
    ).toEqual({ valid: true, season: 111, entries: [{ id: 'nested' }] })
  })

  it('rejects live payloads without season metadata', () => {
    expect(
      normalizeRaidPayload(
        { entries: [] },
        {
          isHistorical: false,
          requestedSeason: null
        }
      ).valid
    ).toBe(false)
  })

  it.each([
    { season: 'bad', entries: [] },
    { season: 112, entries: [] },
    { season: null, entries: [] }
  ])('rejects invalid or mismatched historical metadata %j', (payload) => {
    expect(
      normalizeRaidPayload(payload, {
        isHistorical: true,
        requestedSeason: 111
      }).valid
    ).toBe(false)
  })

  it('accepts historical endpoint payloads that omit season metadata', () => {
    expect(
      normalizeRaidPayload(
        { entries: [] },
        {
          isHistorical: true,
          requestedSeason: 111
        }
      )
    ).toEqual({ valid: true, entries: [], season: 111 })
  })
})
