import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  OVERRIDE_GZ_FILENAME,
  resolveEffectiveGlobalConfig
} from './effective-global-config'

const baked = {
  configVersion: 'baked111',
  extractedAt: '2026-08-26T14:00:00.000Z',
  guildBoss: { guildBossSeasonConfigRotation: ['c1'] }
}

let root: string
let dataDir: string
let overrideDir: string

const writeBaked = (obj: object = baked) =>
  writeFileSync(path.join(dataDir, 'GlobalConfig.json'), JSON.stringify(obj))
const writeOverride = (obj: object, opts?: { corrupt?: boolean }) =>
  writeFileSync(
    path.join(overrideDir, OVERRIDE_GZ_FILENAME),
    opts?.corrupt
      ? Buffer.from('not gzip at all')
      : gzipSync(Buffer.from(JSON.stringify(obj)))
  )

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lokicfg-'))
  dataDir = path.join(root, 'data')
  overrideDir = path.join(root, 'override')
  mkdirSync(dataDir)
  mkdirSync(overrideDir)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('effective GlobalConfig resolution', () => {
  it('no override dir configured => baked, byte-identical behavior', () => {
    writeBaked()
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir: undefined })
    expect(r.overrideActive).toBe(false)
    expect(r.effective?.source).toBe('baked')
    expect(r.effective?.configVersion).toBe('baked111')
  })

  it('a strictly-newer override wins', () => {
    writeBaked()
    writeOverride({
      ...baked,
      configVersion: 'fresh222',
      extractedAt: '2026-08-30T13:00:00.000Z'
    })
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(true)
    expect(r.effective?.source).toBe('override')
    expect(r.effective?.configVersion).toBe('fresh222')
  })

  it('split-brain: a later deploy baking a NEWER copy retires the override', () => {
    writeBaked({
      ...baked,
      configVersion: 'evenfresher333',
      extractedAt: '2026-09-02T00:00:00.000Z'
    })
    writeOverride({
      ...baked,
      configVersion: 'fresh222',
      extractedAt: '2026-08-30T13:00:00.000Z'
    })
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(false)
    expect(r.effective?.configVersion).toBe('evenfresher333')
  })

  it('same version as baked => baked (extractedAt-only bump never flips)', () => {
    writeBaked()
    writeOverride({ ...baked, extractedAt: '2026-09-01T00:00:00.000Z' })
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(false)
  })

  it('an override missing extractedAt never wins (CDN body unstamped)', () => {
    writeBaked()
    writeOverride({ configVersion: 'fresh222', guildBoss: {} })
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(false)
  })

  it('a corrupt override falls back to baked', () => {
    writeBaked()
    writeOverride({}, { corrupt: true })
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(false)
    expect(r.effective?.configVersion).toBe('baked111')
  })

  it('override dir configured but file absent => baked', () => {
    writeBaked()
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(false)
    expect(r.effective?.source).toBe('baked')
  })

  it('nothing readable at all => effective null', () => {
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.effective).toBeNull()
  })

  it('round-trips the payload shape the route emits (gz base64)', () => {
    writeBaked()
    const stamped = {
      configVersion: 'live444',
      extractedAt: new Date('2026-08-30T14:00:00Z').toISOString(),
      guildBoss: { guildBossSeasonConfigRotation: ['c1'] }
    }
    const b64 = gzipSync(Buffer.from(JSON.stringify(stamped))).toString(
      'base64'
    )
    writeFileSync(
      path.join(overrideDir, OVERRIDE_GZ_FILENAME),
      Buffer.from(b64, 'base64')
    )
    const r = resolveEffectiveGlobalConfig({ dataDir, overrideDir })
    expect(r.overrideActive).toBe(true)
    expect(r.effective?.configVersion).toBe('live444')
  })
})
