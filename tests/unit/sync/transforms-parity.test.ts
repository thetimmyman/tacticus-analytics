import { describe, it, expect } from 'vitest'
import { processRaidEntry as appProcess } from '@/app/lib/sync/transformers'
import { processRaidEntry as edgeProcess } from '@/supabase/functions/_shared/sync-modules/transforms.ts'

/** Edge and app processRaidEntry run identical fixtures, scoped to past divergences. */

const bossMappings = { Szarekh: { 1: 'Szarekh Prime 1', 2: 'Szarekh Prime 2' } }
const appMappings = new Map([['user123', 'TestPlayer']])
const edgeMappings: Record<string, string> = { user123: 'TestPlayer' }

// Season type differs by design (edge: number, app: string).
function runBoth(entry: Record<string, unknown>) {
  const app = appProcess(
    entry as never,
    'GUILD',
    '103',
    appMappings as never,
    bossMappings as never,
    null,
    null
  )
  const edge = edgeProcess(
    entry as never,
    'GUILD',
    103 as never,
    edgeMappings as never,
    bossMappings as never,
    null,
    null
  )
  return { app, edge }
}

describe('processRaidEntry edge<->app parity (WI-1810 drift guard)', () => {
  it('both DROP an entry with a missing encounterIndex (no phantom main-boss row)', () => {
    const { app, edge } = runBoth({ userId: 'user123', type: 'Szarekh' })
    expect(app).toBeNull()
    expect(edge).toBeNull()
  })

  it('both DROP an entry with a non-numeric encounterIndex', () => {
    const { app, edge } = runBoth({
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 'oops'
    })
    expect(app).toBeNull()
    expect(edge).toBeNull()
  })

  it('both yield NON-NULL startedOn/completedOn when the entry omits timestamps (dedup-safe)', () => {
    const { app, edge } = runBoth({
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 1000
    })
    expect(app).not.toBeNull()
    expect(edge).not.toBeNull()
    expect(app!.startedOn).toBeTruthy()
    expect(app!.completedOn).toBeTruthy()
    expect(edge!.startedOn).toBeTruthy()
    expect(edge!.completedOn).toBeTruthy()
  })

  it('both fall back to entry.timestamp for startedOn/completedOn when only timestamp is present (C4 dedup-key parity)', () => {
    // Both paths must derive the same timestamp, or the dedup breaks when a guild switches writers.
    const { app, edge } = runBoth({
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 1000,
      startedOn: null,
      completedOn: null,
      timestamp: 1718000000
    })
    expect(app).not.toBeNull()
    expect(edge).not.toBeNull()
    expect(edge!.startedOn).toBe(app!.startedOn)
    expect(edge!.completedOn).toBe(app!.completedOn)
    expect(edge!.startedOn).toBe('2024-06-10T06:13:20.000Z')
    expect(edge!.completedOn).toBe('2024-06-10T06:13:20.000Z')
  })

  it('both KEEP a valid main-boss entry and agree on the stringified Season', () => {
    const entry = {
      userId: 'user123',
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 500000,
      startedOn: '2024-01-15T10:00:00Z',
      completedOn: '2024-01-15T10:05:00Z'
    }
    const { app, edge } = runBoth(entry)
    expect(app).not.toBeNull()
    expect(edge).not.toBeNull()
    expect(edge!.Season).toBe(app!.Season)
    expect(edge!.Season).toBe('103')
  })

  it('both use the payload username identically, and both keep a Player# alias fallback-safe (PS-659)', () => {
    const real = runBoth({
      userId: 'newUser',
      username: 'RealUpstreamName',
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 1000
    })
    expect(real.app).not.toBeNull()
    expect(real.edge).not.toBeNull()
    expect(real.app!.displayName).toBe('RealUpstreamName')
    expect(real.edge!.displayName).toBe('RealUpstreamName')

    const alias = runBoth({
      userId: 'aliasUser',
      username: 'Player#DEADBE',
      type: 'Szarekh',
      encounterIndex: 0,
      damageDealt: 1000
    })
    expect(alias.app).not.toBeNull()
    expect(alias.edge).not.toBeNull()
    expect(alias.app!.displayName).not.toBe('Player#DEADBE')
    expect(alias.edge!.displayName).not.toBe('Player#DEADBE')
    expect(alias.app!.displayName).toBe(alias.edge!.displayName)
  })
})
