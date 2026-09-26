import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/onboarding/profile/claim/route'

describe('/api/onboarding/profile/claim tombstone', () => {
  it('returns 410 without reading or replaying a caller-supplied body', async () => {
    const request = new NextRequest(
      'http://localhost/api/onboarding/profile/claim',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: 'CALLER-CHOSEN' })
      }
    )

    const response = POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'This claim flow has been retired. Use a single-use invite code.',
      code: 'CLAIM_FLOW_RETIRED',
      claim_url: '/onboarding/claim'
    })
    await expect(request.json()).resolves.toEqual({
      playerId: 'CALLER-CHOSEN'
    })
  })
})
