/** Note keys distinguish cleared (`null`) from never set (absent) so a clear can shadow a legacy note. */
import { describe, expect, it } from 'vitest'
import {
  parseSeasonNoteField,
  resolveNoteOverride
} from '@/app/lib/boss-ops/season-note-field'

describe('parseSeasonNoteField', () => {
  it('parses a string value through unchanged', () => {
    expect(parseSeasonNoteField('x')).toBe('x')
  })

  it('parses an explicit JSON null as null (cleared)', () => {
    expect(parseSeasonNoteField(null)).toBeNull()
  })

  it('parses a missing key as undefined (never set)', () => {
    expect(parseSeasonNoteField(undefined)).toBeUndefined()
  })

  it('treats a malformed (non-string, non-null) value as undefined, not as cleared', () => {
    // jsonb is untyped; stray types defer to the legacy fallback rather than blank a note.
    expect(parseSeasonNoteField(42)).toBeUndefined()
    expect(parseSeasonNoteField({ oops: true })).toBeUndefined()
  })
})

describe('resolveNoteOverride', () => {
  const LEGACY = 'legacy herald_boss_config note'

  it('a string override wins over a legacy note', () => {
    expect(resolveNoteOverride('override text', LEGACY)).toBe('override text')
  })

  it('an explicit null override resolves to null and does NOT fall back to the legacy note', () => {
    expect(resolveNoteOverride(null, LEGACY)).toBeNull()
  })

  it('an undefined override (never set) falls back to the legacy note', () => {
    expect(resolveNoteOverride(undefined, LEGACY)).toBe(LEGACY)
  })

  it('an undefined override with no legacy note resolves to null', () => {
    expect(resolveNoteOverride(undefined, null)).toBeNull()
  })

  it("does not trim or blank-check either input (policy is the caller's)", () => {
    expect(resolveNoteOverride('', LEGACY)).toBe('')
    expect(resolveNoteOverride(undefined, '')).toBe('')
  })
})
