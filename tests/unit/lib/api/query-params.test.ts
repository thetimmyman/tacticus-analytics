import { describe, expect, it } from 'vitest'
import {
  escapeLike,
  parseIntParam,
  parseNumberParam,
  parseOptionalNumberParam,
  parsePositiveInt
} from '@/app/lib/api/query-params'

describe('parsePositiveInt', () => {
  it('floors positive numerics', () => {
    expect(parsePositiveInt('12.9', 5)).toBe(12)
    expect(parsePositiveInt('3', 5)).toBe(3)
  })
  it('falls back on zero, negatives, NaN, undefined', () => {
    expect(parsePositiveInt('0', 5)).toBe(5)
    expect(parsePositiveInt('-2', 5)).toBe(5)
    expect(parsePositiveInt('abc', 5)).toBe(5)
    expect(parsePositiveInt(undefined, 5)).toBe(5)
  })
})

describe('parseIntParam', () => {
  it('parses base-10 ints incl. negatives', () => {
    expect(parseIntParam('42', 7)).toBe(42)
    expect(parseIntParam('-3', 7)).toBe(-3)
    expect(parseIntParam('12px', 7)).toBe(12) // parseInt prefix semantics
  })
  it('falls back on null/empty/non-numeric', () => {
    expect(parseIntParam(null, 7)).toBe(7)
    expect(parseIntParam('', 7)).toBe(7)
    expect(parseIntParam('abc', 7)).toBe(7)
  })
})

describe('parseNumberParam / parseOptionalNumberParam', () => {
  it('accepts any finite number', () => {
    expect(parseNumberParam('1.5', 0)).toBe(1.5)
    expect(parseNumberParam('-2', 0)).toBe(-2)
    expect(parseOptionalNumberParam('3.25')).toBe(3.25)
  })
  it('falls back / nulls on invalid', () => {
    expect(parseNumberParam('abc', 9)).toBe(9)
    expect(parseNumberParam(null, 9)).toBe(9)
    expect(parseOptionalNumberParam('abc')).toBeNull()
    expect(parseOptionalNumberParam(null)).toBeNull()
  })
})

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_done\\x')).toBe('50\\%\\_done\\\\x')
  })
  it('passes plain strings through', () => {
    expect(escapeLike('plain')).toBe('plain')
  })
})
