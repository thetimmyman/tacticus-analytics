import { describe, expect, it } from 'vitest'
import {
  buildZoneSearchClauses,
  isValidWarExplorerTab
} from '@/app/(dashboard)/war-explorer/useGuildWarExplorerData'

describe('war explorer model', () => {
  it('validates supported URL tabs', () => {
    expect(isValidWarExplorerTab('activity')).toBe(true)
    expect(isValidWarExplorerTab('unknown')).toBe(false)
    expect(isValidWarExplorerTab(null)).toBe(false)
  })

  it('expands display-name searches to canonical zone types', () => {
    const clauses = buildZoneSearchClauses('Vox-Station')

    expect(clauses).toContain('guild_code.ilike.%Vox-Station%')
    expect(clauses).toContain('zone_type.ilike.%Vox-Station%')
    expect(clauses).toContain('zone_type.eq.ComsStation')
  })
})
