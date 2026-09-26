import { describe, expect, it } from 'vitest'

import {
  jsonArrayLength,
  latestHttpStatus
} from '@/app/api/health/health-probes'
import { sanitizeHealthSnapshot } from '@/app/api/health/health-snapshot-model'

describe('health probe parsing', () => {
  it('recognizes classic wget and wget2 status formats', () => {
    expect(latestHttpStatus('HTTP/1.1 401 Unauthorized')).toBe(401)
    expect(latestHttpStatus(':status: 200')).toBe(200)
    expect(latestHttpStatus('HTTP ERROR response 503 [url]')).toBe(503)
    expect(latestHttpStatus('no response')).toBeNull()
  })

  it('extracts a JSON array body after response noise', () => {
    expect(
      jsonArrayLength('headers and noise\n[{"ok":true}, {"ok":false}]')
    ).toBe(2)
    expect(jsonArrayLength('{"not":"an array"}')).toBeNull()
  })
})

describe('public health snapshot', () => {
  it('keeps safe scalar details and removes operational internals', () => {
    const result = sanitizeHealthSnapshot(
      {
        status: 'degraded',
        timestamp: '2026-01-01T00:00:00.000Z',
        checks: {
          database: {
            status: 'fail',
            responseTime: 25,
            details: {
              provider: 'supabase',
              connected: false,
              error: 'wget http://internal-host failed',
              containers: { database: 'stopped' }
            }
          }
        },
        memory: { heapUsed: 1, heapTotal: 2, rss: 3, unit: 'MB' },
        uptime: 10,
        environment: 'production',
        deployment: 'minipc',
        cronRole: 'primary',
        responseTime: 30
      },
      'request-1'
    )

    expect(result).toEqual({
      status: 'degraded',
      timestamp: '2026-01-01T00:00:00.000Z',
      checks: {
        database: {
          status: 'fail',
          responseTime: 25,
          details: { provider: 'supabase', connected: false }
        }
      },
      responseTime: 30,
      requestId: 'request-1'
    })
  })
})
