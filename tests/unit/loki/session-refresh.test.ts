import {
  buildLokiConnectPayload,
  findLokiSessionId
} from '@/app/lib/loki/session-refresh'

describe('LOKI session refresh core', () => {
  it('builds the canonical CONNECT payload', () => {
    const payload = buildLokiConnectPayload(
      'user-1',
      'secret-1',
      'build-1',
      1234
    )
    expect(payload.playerEvent.playerEventType).toBe('CONNECT')
    expect(payload.playerEvent.playerEventData).toMatchObject({
      userId: 'user-1',
      clientSecret: 'secret-1',
      deviceData: { buildString: 'build-1' }
    })
    expect(payload.playerEvent.createdOn).toBe('1234')
  })

  it('finds session identifiers across known and nested response shapes', () => {
    expect(findLokiSessionId({ sessionId: 'session-value-123' })).toBe(
      'session-value-123'
    )
    expect(
      findLokiSessionId({ eventResult: { data: { session: 'nested-12345' } } })
    ).toBe('nested-12345')
    expect(findLokiSessionId({ sessionId: 'short' })).toBeNull()
  })
})
