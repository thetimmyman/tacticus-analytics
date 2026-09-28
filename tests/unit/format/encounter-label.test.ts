import { describe, it, expect } from 'vitest'
import { formatEncounterLabel } from '@/app/lib/format/encounter-label'

describe('formatEncounterLabel', () => {
  it('plain style', () => {
    expect(formatEncounterLabel(0)).toBe('Main')
    expect(formatEncounterLabel(1)).toBe('Prime 1')
    expect(formatEncounterLabel(2)).toBe('Prime 2')
  })

  it('parens style (suffix; main unadorned)', () => {
    expect(formatEncounterLabel(0, 'parens')).toBe('')
    expect(formatEncounterLabel(1, 'parens')).toBe(' (Prime 1)')
  })

  it('dot style', () => {
    expect(formatEncounterLabel(0, 'dot')).toBe(' · Main')
    expect(formatEncounterLabel(2, 'dot')).toBe(' · Prime 2')
  })

  it('short style', () => {
    expect(formatEncounterLabel(0, 'short')).toBe('')
    expect(formatEncounterLabel(1, 'short')).toBe(' · P1')
  })
})
