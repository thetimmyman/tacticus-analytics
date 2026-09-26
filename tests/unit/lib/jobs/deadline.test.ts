import { describe, expect, it } from 'vitest'

import { softDeadlineFor } from '@/app/lib/jobs/deadline'

// The effective soft deadline is the earlier of the handler budget and ctx.softDeadlineAt.
describe('softDeadlineFor', () => {
  const start = 1_000_000

  it('returns the handler budget when no tick deadline is set (non-tick caller)', () => {
    expect(softDeadlineFor(start, 240_000, {})).toBe(start + 240_000)
    expect(softDeadlineFor(start, 360_000, { softDeadlineAt: undefined })).toBe(
      start + 360_000
    )
  })

  it('returns the tick deadline when it is tighter than the handler budget', () => {
    const tickDeadline = start + 5_000
    expect(
      softDeadlineFor(start, 360_000, { softDeadlineAt: tickDeadline })
    ).toBe(tickDeadline)
  })

  it('returns the handler budget when it is tighter than the tick deadline', () => {
    const tickDeadline = start + 300_000
    expect(
      softDeadlineFor(start, 240_000, { softDeadlineAt: tickDeadline })
    ).toBe(start + 240_000)
  })

  it('an already-past tick deadline yields an immediately-exceeded deadline', () => {
    const tickDeadline = start - 1
    const deadline = softDeadlineFor(start, 240_000, {
      softDeadlineAt: tickDeadline
    })
    expect(deadline).toBe(tickDeadline)
    expect(start >= deadline).toBe(true) // handler exits on its first loop check
  })
})
