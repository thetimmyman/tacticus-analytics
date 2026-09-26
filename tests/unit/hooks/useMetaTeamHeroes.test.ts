/** meta_atlas_data is service_role-only, so every classifier team must get heroes from the client baseline alone. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMetaTeamHeroes } from '@/app/hooks/useMetaTeamHeroes'
import type { MetaTeam } from '@/app/hooks/useMetaTeams'

function makeTeam(
  partial: Partial<MetaTeam> & Pick<MetaTeam, 'id' | 'team_name'>
): MetaTeam {
  return {
    description: null,
    is_meta: true,
    sort_order: 0,
    trigger_heroes: [],
    match_type: 'all',
    ...partial
  }
}

const lavstodes = makeTeam({
  id: 'team-lavstodes',
  team_name: 'Lavstodes',
  trigger_heroes: ['Laviscus', 'Kariyan']
})

const orkz = makeTeam({
  id: 'team-orkz',
  team_name: 'Orkz',
  trigger_heroes: ['Boss Gulgortz', 'Snotflogga']
})

const allTeams = [lavstodes, orkz]

function stubFetch(heroes: string[] = []) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ heroesByTeam: {}, heroes })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('useMetaTeamHeroes', () => {
  beforeEach(() => {
    stubFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns an empty hero set when nothing is selected', () => {
    const { result } = renderHook(() => useMetaTeamHeroes([], allTeams))
    expect(result.current.expandedHeroNames.size).toBe(0)
    expect(result.current.teamCount).toBe(0)
    expect(result.current.loading).toBe(false)
  })

  it('expands a curated team from RAID_TEAMS (unit_id AND display name)', () => {
    const { result } = renderHook(() =>
      useMetaTeamHeroes([lavstodes.id], allTeams)
    )
    const names = result.current.expandedHeroNames
    expect(names.has('emperexultant')).toBe(true) // Laviscus
    expect(names.has('custotrajann')).toBe(true) // Trajann
    expect(names.has('laviscus')).toBe(true)
    expect(names.has('trajann')).toBe(true)
    expect(names.size).toBeGreaterThan(2)
    expect(result.current.teamCount).toBe(1)
  })

  it('falls back to trigger_heroes for a team with no curated roster', () => {
    const { result } = renderHook(() => useMetaTeamHeroes([orkz.id], allTeams))
    const names = result.current.expandedHeroNames
    expect(names.has('boss gulgortz')).toBe(true)
    expect(names.has('snotflogga')).toBe(true)
    expect(result.current.teamCount).toBe(1)
    expect(names.size).toBeGreaterThan(0)
  })

  it('unions heroes across multiple selected teams', () => {
    const { result } = renderHook(() =>
      useMetaTeamHeroes([lavstodes.id, orkz.id], allTeams)
    )
    const names = result.current.expandedHeroNames
    expect(names.has('laviscus')).toBe(true)
    expect(names.has('snotflogga')).toBe(true)
    expect(result.current.teamCount).toBe(2)
  })

  it('ignores selected ids that are not in the meta-teams list', () => {
    const { result } = renderHook(() =>
      useMetaTeamHeroes(['does-not-exist'], allTeams)
    )
    expect(result.current.expandedHeroNames.size).toBe(0)
    expect(result.current.teamCount).toBe(0)
  })

  it('merges Meta Atlas heroes from the API on top of the baseline', async () => {
    stubFetch(['archimatos', 'eldryon']) // atlas-only heroes not in the baseline
    const { result } = renderHook(() => useMetaTeamHeroes([orkz.id], allTeams))

    expect(result.current.expandedHeroNames.has('snotflogga')).toBe(true)

    await waitFor(() => {
      expect(result.current.expandedHeroNames.has('archimatos')).toBe(true)
    })
    expect(result.current.expandedHeroNames.has('eldryon')).toBe(true)
    expect(result.current.expandedHeroNames.has('snotflogga')).toBe(true)
  })

  it('keeps the baseline filtering when the Meta Atlas API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() =>
      useMetaTeamHeroes([lavstodes.id], allTeams)
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.expandedHeroNames.has('laviscus')).toBe(true)
    expect(result.current.expandedHeroNames.size).toBeGreaterThan(0)
  })
})
