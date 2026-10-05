import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readReferenceHeroes,
  initializeReferenceHeroes
} from '../launcher/reference-catalog.mjs'
const fixture = () => ({
  gameId: 'syntheticHero',
  id: 'synthetic-hero',
  name: "Synthetic Hero's Label",
  longName: 'Synthetic Hero',
  factionId: 'SyntheticFaction',
  allianceId: 'Imperial',
  traits: []
})
test('bundled catalogue projects static metadata and deterministic IDs with quoted transactional upsert', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-reference-'))
  try {
    await mkdir(join(root, 'heroes'))
    await writeFile(
      join(root, 'heroes', 'hero.json'),
      JSON.stringify({ ...fixture(), secret: 'ignored-reference-extra' })
    )
    const first = await readReferenceHeroes(root),
      again = await readReferenceHeroes(root)
    assert.deepEqual(first, again)
    assert.equal(first[0].unitId, 'syntheticHero')
    assert.equal(first[0].engineId, 'synthetic-hero')
    assert.equal(first[0].category, 'Hero')
    assert(first[0].id >= 1000000 && first[0].id <= 2147483647)
    assert(!JSON.stringify(first).includes('ignored-reference-extra'))
    let sql
    const result = await initializeReferenceHeroes(
      {
        psql: async (value) => {
          sql = value
        }
      },
      root
    )
    assert.deepEqual(result, {
      entries: 1,
      source: 'bundled-reference-definitions'
    })
    assert(sql.startsWith('BEGIN;'))
    assert(sql.endsWith('COMMIT;'))
    assert(sql.includes("Synthetic Hero''s Label"))
    assert(!sql.includes('DELETE'))
    assert(sql.includes('WHERE public.hero_mappings.id=EXCLUDED.id'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('malformed later definitions, duplicate units and linked entries refuse before SQL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-reference-'))
  try {
    await mkdir(join(root, 'heroes'))
    await writeFile(join(root, 'heroes', 'a.json'), JSON.stringify(fixture()))
    const extra = join(root, 'heroes', 'z.json')
    let calls = 0
    const services = { psql: async () => calls++ }
    for (const data of [
      { ...fixture(), gameId: 'bad/id' },
      fixture(),
      { ...fixture(), gameId: 'second', name: null }
    ]) {
      await writeFile(extra, JSON.stringify(data))
      await assert.rejects(initializeReferenceHeroes(services, root))
      assert.equal(calls, 0)
    }
    await rm(extra)
    await symlink(join(root, 'heroes', 'a.json'), extra)
    await assert.rejects(initializeReferenceHeroes(services, root))
    assert.equal(calls, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
