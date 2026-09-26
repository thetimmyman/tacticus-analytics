import { describe, expect, it } from 'vitest'
import { parseJsonBody } from '@/app/lib/api/parse-json-body'
import { AppError, Errors } from '@/app/lib/errors/AppError'

describe('parseJsonBody', () => {
  it('returns the parsed body on valid JSON', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'Content-Type': 'application/json' }
    })
    await expect(
      parseJsonBody(request, () => Errors.validation('nope'))
    ).resolves.toEqual({
      a: 1
    })
  })

  it('throws the exact factory error on malformed JSON', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: '{bad json',
      headers: { 'Content-Type': 'application/json' }
    })
    const custom = Errors.validation('Invalid request body', {
      endpoint: '/api/example'
    })
    try {
      await parseJsonBody(request, () => custom)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBe(custom)
      expect(err).toBeInstanceOf(AppError)
    }
  })

  it('throws on an empty body (json() rejects)', async () => {
    const request = new Request('http://localhost/x', { method: 'POST' })
    await expect(
      parseJsonBody(request, () => Errors.validation('empty'))
    ).rejects.toBeInstanceOf(AppError)
  })
})
