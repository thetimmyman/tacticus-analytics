import { readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { withEntry, readBounded } from '../proof/safe-files.mjs'

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const label = (value, max = 128) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Invalid bundled reference data')
  return value.trim()
}
const identifier = (value) => {
  const id = label(value, 100)
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error('Invalid bundled reference identifier')
  return id
}

// Package-owned definitions only. This never reads game clients or player data.
export async function readReferenceHeroes(directory) {
  return withEntry(
    join(directory, 'heroes'),
    async (_handle, metadata, anchor) => {
      if (!metadata.isDirectory())
        throw new Error('Invalid reference directory')
      const entries = (await readdir(anchor))
        .filter((name) => name.endsWith('.json'))
        .sort()
      if (!entries.length || entries.length > 2048)
        throw new Error('Invalid reference catalogue')
      const heroes = [],
        ids = new Set()
      for (const name of entries) {
        const raw = await withEntry(
          join(anchor, name),
          async (handle, info) => {
            if (!info.isFile()) throw new Error('Invalid reference entry')
            return readBounded(handle, 2 * 1024 * 1024)
          }
        )
        const data = JSON.parse(raw.toString('utf8'))
        const unitId = identifier(data.gameId),
          engineId = identifier(data.id)
        if (ids.has(unitId)) throw new Error('Duplicate reference unit')
        ids.add(unitId)
        const id =
          1000000 +
          (createHash('sha256')
            .update('desktop-reference:' + unitId)
            .digest()
            .readUInt32BE(0) &
            0x3fffffff)
        heroes.push({
          id,
          unitId,
          engineId,
          name: label(data.name),
          longName: label(data.longName || data.name),
          faction: identifier(data.factionId),
          alliance: identifier(data.allianceId),
          category:
            Array.isArray(data.traits) && data.traits.includes('MachineOfWar')
              ? 'MOW'
              : 'Hero'
        })
      }
      return heroes
    }
  )
}

export async function initializeReferenceHeroes(services, directory) {
  const heroes = await readReferenceHeroes(directory)
  const values = heroes
    .map(
      (h) =>
        `(${h.id},${quote(h.unitId)},${quote(h.name)},${quote(h.longName)},${quote(h.engineId)},${quote(h.faction)},${quote(h.alliance)},${quote(h.category)})`
    )
    .join(',')
  // Never delete reference rows or replace their IDs: saved rosters refer to them.
  // An unexpected ID collision rolls back the entire reference refresh.
  await services.psql(`BEGIN;
    INSERT INTO public.hero_mappings(id,unit_id,display_name,long_name,game_id,faction_id,alliance_id,category)
    VALUES ${values}
    ON CONFLICT(unit_id) DO UPDATE SET display_name=EXCLUDED.display_name,long_name=EXCLUDED.long_name,game_id=EXCLUDED.game_id,faction_id=EXCLUDED.faction_id,alliance_id=EXCLUDED.alliance_id,category=EXCLUDED.category
    WHERE public.hero_mappings.id=EXCLUDED.id;
    COMMIT;`)
  return { entries: heroes.length, source: 'bundled-reference-definitions' }
}
