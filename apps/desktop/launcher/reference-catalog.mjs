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

export async function readReferenceBosses(directory) {
  return withEntry(
    join(directory, 'guild-raid'),
    async (_file, info, anchor) => {
      if (!info.isDirectory()) throw new Error('Invalid reference directory')
      const readJson = (path) =>
        withEntry(path, async (handle, metadata) => {
          if (!metadata.isFile()) throw new Error('Invalid reference entry')
          return JSON.parse(
            (await readBounded(handle, 8 * 1024 * 1024)).toString('utf8')
          )
        })
      const seasons = await readJson(join(anchor, 'seasons.json'))
      if (
        !Array.isArray(seasons.seasons) ||
        !seasons.seasons.length ||
        seasons.seasons.length > 128
      )
        throw new Error('Invalid reference seasons')
      const encounters = new Map()
      for (const season of seasons.seasons) {
        if (!Array.isArray(season.sets) || season.sets.length > 128)
          throw new Error('Invalid reference sets')
        for (const set of season.sets) {
          if (!Array.isArray(set.encounters) || set.encounters.length > 16)
            throw new Error('Invalid reference encounters')
          for (const encounter of set.encounters) {
            const bossType = identifier(encounter.bossType),
              index = encounter.encounterIndex
            if (
              ![0, 1, 2].includes(index) ||
              typeof encounter.unitId !== 'string'
            )
              throw new Error('Invalid reference encounter')
            const unitId = identifier(encounter.unitId.replace(/:\d+$/, ''))
            const key = bossType + ':' + index
            if (encounters.has(key) && encounters.get(key).unitId !== unitId)
              throw new Error('Conflicting reference encounter')
            encounters.set(key, { bossType, index, unitId })
          }
        }
      }
      if (!encounters.size || encounters.size > 512)
        throw new Error('Invalid reference catalogue')
      return withEntry(
        join(anchor, 'bosses'),
        async (_handle, metadata, bosses) => {
          if (!metadata.isDirectory())
            throw new Error('Invalid reference directory')
          const entries = []
          for (const [key, encounter] of [...encounters].sort(([a], [b]) =>
            a.localeCompare(b)
          )) {
            const definition = await readJson(
              join(bosses, encounter.unitId + '.json')
            )
            if (definition.gameId !== encounter.unitId)
              throw new Error('Reference unit mismatch')
            entries.push({
              ...encounter,
              name: label(definition.name),
              id:
                1000000 +
                (createHash('sha256')
                  .update('desktop-boss-reference:' + key)
                  .digest()
                  .readUInt32BE(0) &
                  0x3fffffff)
            })
          }
          if (new Set(entries.map((e) => e.id)).size !== entries.length)
            throw new Error('Reference identifier collision')
          return entries
        }
      )
    }
  )
}

export async function initializeReferenceBosses(services, directory) {
  const entries = await readReferenceBosses(directory)
  const values = entries
    .map(
      (e) =>
        `(${e.id},${quote(e.bossType)},${e.index},${quote(e.name)},${quote(e.unitId)})`
    )
    .join(',')
  await services.psql(`BEGIN;
    CREATE TEMP TABLE desktop_reference_bosses(id integer,boss_type text,encounter_index integer,boss_name text,unit_id text) ON COMMIT DROP;
    INSERT INTO desktop_reference_bosses VALUES ${values};
    DO $catalog$ BEGIN
      IF EXISTS(SELECT 1 FROM public.boss_mapping b JOIN desktop_reference_bosses r USING(boss_type,encounter_index) GROUP BY b.boss_type,b.encounter_index HAVING count(*)>1) OR
         EXISTS(SELECT 1 FROM public.boss_mapping b JOIN desktop_reference_bosses r ON b.id=r.id WHERE b.boss_type<>r.boss_type OR b.encounter_index<>r.encounter_index)
      THEN RAISE EXCEPTION 'Reference catalogue collision'; END IF;
    END $catalog$;
    UPDATE public.boss_mapping b SET boss_name=r.boss_name,unit_id=r.unit_id FROM desktop_reference_bosses r
      WHERE b.boss_type=r.boss_type AND b.encounter_index=r.encounter_index;
    INSERT INTO public.boss_mapping(id,boss_type,encounter_index,boss_name,unit_id,asset_source)
      SELECT r.id,r.boss_type,r.encounter_index,r.boss_name,r.unit_id,'bundled-reference' FROM desktop_reference_bosses r
      WHERE NOT EXISTS(SELECT 1 FROM public.boss_mapping b WHERE b.boss_type=r.boss_type AND b.encounter_index=r.encounter_index);
    COMMIT;`)
  return { entries: entries.length, source: 'bundled-reference-definitions' }
}
