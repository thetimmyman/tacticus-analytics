import { describe, expect, it, vi } from 'vitest'

import {
  assessSeasonRetention,
  buildSyncCompletion,
  computeSeasonWindow,
  disambiguateDuplicateDisplayNames
} from '@/supabase/functions/sync-modular-workflow/workflow-helpers'

describe('sync workflow helpers', () => {
  it('computes the active window using the in-game season offset', () => {
    expect(
      computeSeasonWindow(1, {
        firstSeasonStartMs: 0,
        seasonCycleSeconds: 100,
        seasonGapSeconds: 10
      })
    ).toEqual({
      startsAtIso: '1970-01-01T00:16:50.000Z',
      endsAtIso: '1970-01-01T00:18:20.000Z'
    })
  })

  it('deterministically disambiguates duplicate display names', () => {
    const warn = vi.fn()
    const members = disambiguateDuplicateDisplayNames(
      [
        { userId: 'b', displayName: 'Alex', role: 'member' },
        { userId: 'a', displayName: 'Alex', role: 'officer' },
        { userId: 'c', displayName: 'Blair', role: 'member' }
      ],
      'EOT',
      { warn }
    )

    expect(members.map((member) => member.displayName)).toEqual([
      'Alex (EOT_01)',
      'Alex (EOT_02)',
      'Blair'
    ])
    expect(members[0]).toMatchObject({
      userId: 'a',
      originalDisplayName: 'Alex'
    })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('identifies missing recent seasons', () => {
    expect(assessSeasonRetention([30, 28, 8, 30], 31, 5, 20)).toEqual({
      seasonCount: 3,
      needsBackfill: true,
      missingSeasons: [29, 27, 26]
    })
  })

  it('detects a recent gap even with five older seasons present', () => {
    expect(
      assessSeasonRetention([110, 109, 108, 107, 105, 104, 103], 110, 5, 20)
        .missingSeasons
    ).toEqual([106])
  })

  it('builds one consistent summary, response execution block, and warnings', () => {
    const completion = buildSyncCompletion(
      {
        correlationId: 'sync-1',
        season: 42,
        startedAt: 100,
        lockAcquireStarted: 1000,
        lockAcquiredAt: 7001,
        rawEntries: 0,
        droppedEntries: 2,
        validEntries: 4,
        processedEntries: 3,
        upsertedEntries: 2,
        insertedEntries: 1,
        updatedEntries: 1,
        errorEntries: 1,
        bombEntries: 1,
        lokiMappingsRefreshed: true
      },
      { elapsed: 1000, remaining: 100, progress: 0.456, shouldTerminate: false }
    )

    expect(completion.summary).toMatchObject({
      correlation_id: 'sync-1',
      lock_wait_ms: 6001,
      entries_fetched: 0
    })
    expect(completion.execution.progress_percent).toBe(46)
    expect(completion.warnings).toHaveLength(5)
  })
})
