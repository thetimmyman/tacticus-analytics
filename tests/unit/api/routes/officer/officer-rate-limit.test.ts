import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

// Global setup neutralizes apiSecurityMiddleware; opt back in to exercise real limits.
vi.unmock('@/app/lib/middleware/api-security-middleware')

const requireActiveOfficerCommandAccess = vi.fn()

describe('officer/* API route rate limiting', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireActiveOfficerCommandAccess.mockRejectedValue(
      new AuthError('Unauthorized', 'UNAUTHENTICATED')
    )
    vi.doMock('@/app/lib/auth', () => ({ AuthError }))
    vi.doMock('@/app/api/officer/_shared/access', () => ({
      requireActiveOfficerCommandAccess
    }))
  })

  it('rate-limits GET /api/officer/briefing after 20 requests before auth work', async () => {
    const { GET } = await import('@/app/api/officer/briefing/route')
    const ip = '203.0.113.41'

    for (let i = 0; i < 20; i += 1) {
      const res = await GET(
        new NextRequest('https://tacticusanalytics.com/api/officer/briefing', {
          headers: { 'cf-connecting-ip': ip }
        })
      )
      expect(res.status).toBe(401)
    }

    const callsBeforeLimit = requireActiveOfficerCommandAccess.mock.calls.length
    const limited = await GET(
      new NextRequest('https://tacticusanalytics.com/api/officer/briefing', {
        headers: { 'cf-connecting-ip': ip }
      })
    )

    expect(limited.status).toBe(429)
    expect(limited.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(requireActiveOfficerCommandAccess.mock.calls.length).toBe(
      callsBeforeLimit
    )
  })

  it('rate-limits /api/officer/member-detail and coaching-tasks endpoints after 30 requests', async () => {
    const { GET: memberDetailGet } =
      await import('@/app/api/officer/member-detail/route')
    const { GET: tasksGet, POST: tasksPost } =
      await import('@/app/api/officer/coaching-tasks/route')
    const { PATCH: taskPatch } =
      await import('@/app/api/officer/coaching-tasks/[id]/route')
    const ip = '198.51.100.42'

    for (let i = 0; i < 30; i += 1) {
      const res = await memberDetailGet(
        new NextRequest(
          'https://tacticusanalytics.com/api/officer/member-detail?display_name=Alpha',
          { headers: { 'cf-connecting-ip': ip } }
        )
      )
      expect(res.status).toBe(401)
    }

    const callsBeforeLimit = requireActiveOfficerCommandAccess.mock.calls.length

    const limitedMember = await memberDetailGet(
      new NextRequest(
        'https://tacticusanalytics.com/api/officer/member-detail?display_name=Alpha',
        { headers: { 'cf-connecting-ip': ip } }
      )
    )
    const limitedTasksGet = await tasksGet(
      new NextRequest(
        'https://tacticusanalytics.com/api/officer/coaching-tasks?season=90',
        { headers: { 'cf-connecting-ip': ip } }
      )
    )
    const limitedTasksPost = await tasksPost(
      new NextRequest(
        'https://tacticusanalytics.com/api/officer/coaching-tasks',
        {
          method: 'POST',
          headers: {
            'cf-connecting-ip': ip,
            'content-type': 'application/json'
          },
          body: JSON.stringify({})
        }
      )
    )
    const limitedTaskPatch = await taskPatch(
      new NextRequest(
        'https://tacticusanalytics.com/api/officer/coaching-tasks/task-1',
        {
          method: 'PATCH',
          headers: {
            'cf-connecting-ip': ip,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ status: 'acknowledged' })
        }
      ),
      { params: Promise.resolve({ id: 'task-1' }) }
    )

    expect(limitedMember.status).toBe(429)
    expect(limitedTasksGet.status).toBe(429)
    expect(limitedTasksPost.status).toBe(429)
    expect(limitedTaskPatch.status).toBe(429)
    expect(requireActiveOfficerCommandAccess.mock.calls.length).toBe(
      callsBeforeLimit
    )
  })
})
