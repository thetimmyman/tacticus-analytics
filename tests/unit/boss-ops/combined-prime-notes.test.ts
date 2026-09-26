/** The combined box is written back to both note columns, so preview and Herald share one merge. */
import { describe, it, expect } from 'vitest'
import {
  mergeCombinedPrimeNotes,
  previewCombinedPrimeNotes
} from '@/app/lib/boss-ops/combined-prime-notes'

describe('mergeCombinedPrimeNotes', () => {
  it('returns null when neither prime has a note', () => {
    expect(mergeCombinedPrimeNotes(null, 1, null, 2)).toBeNull()
    expect(mergeCombinedPrimeNotes('   ', 1, '', 2)).toBeNull()
  })

  it('emits a single narrative once, with no side heading', () => {
    expect(mergeCombinedPrimeNotes('same plan', 1, 'same plan', 2)).toBe(
      'same plan'
    )
    expect(mergeCombinedPrimeNotes('only side 1', 1, null, 2)).toBe(
      'only side 1'
    )
    expect(mergeCombinedPrimeNotes(null, 1, 'only side 2', 2)).toBe(
      'only side 2'
    )
  })

  it('labels genuinely different notes and orders by encounter index', () => {
    expect(mergeCombinedPrimeNotes('A', 1, 'B', 2)).toBe(
      '**Side 1:** A\n\n**Side 2:** B'
    )
    expect(mergeCombinedPrimeNotes('B', 2, 'A', 1)).toBe(
      '**Side 1:** A\n\n**Side 2:** B'
    )
  })
})

describe('previewCombinedPrimeNotes', () => {
  it('is the dispatcher merge with the hub prime ordering', () => {
    expect(previewCombinedPrimeNotes('A', 'B')).toBe(
      mergeCombinedPrimeNotes('A', 1, 'B', 2)
    )
    expect(previewCombinedPrimeNotes('same', 'same')).toBe(
      mergeCombinedPrimeNotes('same', 1, 'same', 2)
    )
  })

  it('renders an empty string rather than null so it can bind to the view', () => {
    expect(previewCombinedPrimeNotes(null, undefined)).toBe('')
  })

  it('never emits the old unbolded blob the hub used to persist', () => {
    expect(previewCombinedPrimeNotes('A', 'B')).not.toContain('Side 1:\n')
  })

  it('is idempotent under a re-merge — previewing a preview cannot double up', () => {
    const once = previewCombinedPrimeNotes('A', 'B')
    // Both columns holding the merged blob must collapse, not nest a heading.
    expect(previewCombinedPrimeNotes(once, once)).toBe(once)
  })
})
