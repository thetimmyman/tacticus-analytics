import { describe, expect, it } from 'vitest'
import {
  pickSessionTemplates,
  generateSessions
} from '@/app/lib/boss-assignments/season-planner/sessions'

describe('season planner session generation', () => {
  it('picks session templates by highest probability', () => {
    const templates = pickSessionTemplates({
      maxPerDay: 2,
      windows: [
        { hour: 9, daysWithActivity: 1, probability: 0.25 },
        { hour: 18, daysWithActivity: 3, probability: 0.75 },
        { hour: 6, daysWithActivity: 2, probability: 0.5 }
      ]
    })

    expect(templates).toEqual([
      { hour: 18, probability: 0.75 },
      { hour: 6, probability: 0.5 }
    ])
  })

  it('falls back when no windows meet minimum probability', () => {
    const templates = pickSessionTemplates({
      maxPerDay: 1,
      minProbability: 0.5,
      windows: [{ hour: 1, daysWithActivity: 1, probability: 0.1 }]
    })

    expect(templates).toEqual([{ hour: 18, probability: 0 }])
  })

  it('generates sessions within season bounds', () => {
    const sessions = generateSessions({
      seasonStartAt: '2025-01-01T10:00:00.000Z',
      seasonEndAt: '2025-01-03T06:00:00.000Z',
      timeZone: 'UTC',
      templates: [
        { hour: 8, probability: 0.2 },
        { hour: 20, probability: 0.4 }
      ]
    })

    expect(sessions.map((s) => s.at)).toEqual([
      '2025-01-01T20:00:00.000Z',
      '2025-01-02T08:00:00.000Z',
      '2025-01-02T20:00:00.000Z'
    ])
  })
})
