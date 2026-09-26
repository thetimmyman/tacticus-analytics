import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractErrorMessage, fetchJson } from '@/app/lib/api/fetch-json'

type SuccessShape = { success: true; rows: unknown[] }

const isSuccess = (payload: unknown): payload is SuccessShape => {
  if (!payload || typeof payload !== 'object' || !('success' in payload))
    return false
  const c = payload as { success?: unknown; rows?: unknown }
  return c.success === true && Array.isArray(c.rows)
}

function mockFetchOnce(opts: {
  ok: boolean
  status?: number
  json: () => unknown | Promise<unknown>
}) {
  const fetchMock = vi.fn(async () => ({
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => opts.json()
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('extractErrorMessage', () => {
  const fallback = 'fallback message'

  it('returns fallback for null payload', () => {
    expect(extractErrorMessage(null, fallback)).toBe(fallback)
  })

  it('prefers a non-empty string error', () => {
    expect(extractErrorMessage({ error: 'boom' }, fallback)).toBe('boom')
  })

  it('ignores a whitespace-only string error and falls through', () => {
    expect(
      extractErrorMessage({ error: '   ', message: 'msg' }, fallback)
    ).toBe('msg')
  })

  it('reads error.message when error is an object', () => {
    expect(
      extractErrorMessage({ error: { message: 'nested' } }, fallback)
    ).toBe('nested')
  })

  it('falls back to top-level message', () => {
    expect(extractErrorMessage({ message: 'top' }, fallback)).toBe('top')
  })

  it('returns fallback when nothing usable is present', () => {
    expect(extractErrorMessage({}, fallback)).toBe(fallback)
  })
})

describe('fetchJson', () => {
  it('builds the URL with appended params', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: () => ({ success: true, rows: [] })
    })
    const params = new URLSearchParams()
    params.set('guild', 'ABCD')
    params.set('limit', '5000')

    await fetchJson<SuccessShape>('/api/ml/training-features', {
      params,
      errorFallback: 'fb',
      invalidMessage: 'inv',
      validate: isSuccess
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ml/training-features?guild=ABCD&limit=5000'
    )
  })

  it('omits the query string entirely when no params are provided', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: () => ({ success: true, rows: [] })
    })

    await fetchJson<SuccessShape>('/api/ml/inference-inputs', {
      errorFallback: 'fb',
      invalidMessage: 'inv',
      validate: isSuccess
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/ml/inference-inputs')
  })

  it('returns the parsed payload on a valid success response', async () => {
    mockFetchOnce({
      ok: true,
      json: () => ({ success: true, rows: [{ a: 1 }] })
    })

    const result = await fetchJson<SuccessShape>('/api/x', {
      errorFallback: 'fb',
      invalidMessage: 'inv',
      validate: isSuccess
    })

    expect(result).toEqual({ success: true, rows: [{ a: 1 }] })
  })

  it('throws the extracted error message on non-ok response', async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: () => ({ error: 'server exploded' })
    })

    await expect(
      fetchJson<SuccessShape>('/api/x', {
        errorFallback: 'fallback',
        invalidMessage: 'inv',
        validate: isSuccess
      })
    ).rejects.toThrow('server exploded')
  })

  it('throws the error fallback when a non-ok body has no usable message', async () => {
    mockFetchOnce({ ok: false, status: 500, json: () => ({}) })

    await expect(
      fetchJson<SuccessShape>('/api/x', {
        errorFallback: 'fallback message',
        invalidMessage: 'inv',
        validate: isSuccess
      })
    ).rejects.toThrow('fallback message')
  })

  it('swallows JSON parse errors and still throws the fallback on non-ok', async () => {
    mockFetchOnce({
      ok: false,
      status: 502,
      json: () => {
        throw new Error('not json')
      }
    })

    await expect(
      fetchJson<SuccessShape>('/api/x', {
        errorFallback: 'gateway down',
        invalidMessage: 'inv',
        validate: isSuccess
      })
    ).rejects.toThrow('gateway down')
  })

  it('throws the invalid message when ok but the payload shape is wrong', async () => {
    mockFetchOnce({ ok: true, json: () => ({ success: false, rows: [] }) })

    await expect(
      fetchJson<SuccessShape>('/api/x', {
        errorFallback: 'fb',
        invalidMessage: 'bad shape',
        validate: isSuccess
      })
    ).rejects.toThrow('bad shape')
  })

  it('throws the invalid message when ok but rows is not an array', async () => {
    mockFetchOnce({ ok: true, json: () => ({ success: true, rows: 'nope' }) })

    await expect(
      fetchJson<SuccessShape>('/api/x', {
        errorFallback: 'fb',
        invalidMessage: 'bad shape',
        validate: isSuccess
      })
    ).rejects.toThrow('bad shape')
  })

  it('throws the invalid message when ok but the body failed to parse (null)', async () => {
    mockFetchOnce({
      ok: true,
      json: () => {
        throw new Error('not json')
      }
    })

    await expect(
      fetchJson<SuccessShape>('/api/x', {
        errorFallback: 'fb',
        invalidMessage: 'bad shape',
        validate: isSuccess
      })
    ).rejects.toThrow('bad shape')
  })
})
