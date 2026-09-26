import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchMlInferenceInputs,
  fetchMlTrainingFeatures
} from '@/app/lib/ml/fetch-ml-data'

function mockFetch(opts: {
  ok: boolean
  status?: number
  json: () => unknown
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
})

describe('fetchMlTrainingFeatures', () => {
  it('builds the training-features URL with seasons + thresholds + limit', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () => ({ success: true, rows: [] })
    })

    await fetchMlTrainingFeatures('ABCD', ['101', '102'], 25, 2, 5000)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ml/training-features?guild=ABCD&seasons=101%2C102&minMetaAttacks=25&minLoopSamples=2&limit=5000'
    )
  })

  it('omits the seasons param when no seasons are supplied', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () => ({ success: true, rows: [] })
    })

    await fetchMlTrainingFeatures('ABCD', [], 25, 2, 5000)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ml/training-features?guild=ABCD&minMetaAttacks=25&minLoopSamples=2&limit=5000'
    )
  })

  it('throws the training-features fallback on non-ok with no message', async () => {
    mockFetch({ ok: false, json: () => ({}) })
    await expect(
      fetchMlTrainingFeatures('ABCD', [], 25, 2, 5000)
    ).rejects.toThrow('Failed to load ML training features')
  })

  it('throws the training-features invalid message on a bad payload shape', async () => {
    mockFetch({ ok: true, json: () => ({ success: true, rows: 'nope' }) })
    await expect(
      fetchMlTrainingFeatures('ABCD', [], 25, 2, 5000)
    ).rejects.toThrow('Invalid ML training features response')
  })
})

describe('fetchMlInferenceInputs', () => {
  it('builds the inference-inputs URL with season + thresholds', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () => ({ success: true, rows: [] })
    })

    await fetchMlInferenceInputs('ABCD', '103', 25, 2)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ml/inference-inputs?guild=ABCD&season=103&minMetaAttacks=25&minLoopSamples=2'
    )
  })

  it('throws the inference fallback on non-ok with no message', async () => {
    mockFetch({ ok: false, json: () => ({}) })
    await expect(fetchMlInferenceInputs('ABCD', '103', 25, 2)).rejects.toThrow(
      'Failed to load ML inference inputs'
    )
  })

  it('surfaces a server-provided error string on non-ok', async () => {
    mockFetch({ ok: false, json: () => ({ error: 'guild not found' }) })
    await expect(fetchMlInferenceInputs('ABCD', '103', 25, 2)).rejects.toThrow(
      'guild not found'
    )
  })

  it('throws the inference invalid message on a bad payload shape', async () => {
    mockFetch({ ok: true, json: () => ({ success: false }) })
    await expect(fetchMlInferenceInputs('ABCD', '103', 25, 2)).rejects.toThrow(
      'Invalid ML inference response'
    )
  })
})
