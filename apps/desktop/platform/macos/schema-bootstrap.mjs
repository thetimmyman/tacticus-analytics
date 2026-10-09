import { constants } from 'node:fs'
import { open, lstat, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const journalFormat = 'desktop-macos-schema-bootstrap/v1'
const receiptPrefix = 'desktop-macos-schema:'
// The pinned PostgreSQL initdb installs this comment before application SQL.
const initdbComment = 'default administrative connection database'
const refused = () =>
  Object.assign(
    new Error('Local schema state is incompatible; activation refused'),
    {
      code: 'ESCHEMA'
    }
  )

async function close(file) {
  try {
    await file?.close()
  } catch {
    throw refused()
  }
}

async function readBounded(path, limit, privateFile = false) {
  let file
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const info = await file.stat()
    if (
      !info.isFile() ||
      info.size > limit ||
      (privateFile &&
        (info.uid !== process.getuid() ||
          info.mode & 0o077 ||
          info.nlink !== 1))
    )
      throw refused()
    const bytes = Buffer.alloc(limit + 1)
    let size = 0
    while (size < bytes.length) {
      const next = await file.read(bytes, size, bytes.length - size, null)
      if (!next.bytesRead) break
      size += next.bytesRead
    }
    if (size > limit) throw refused()
    return bytes.subarray(0, size)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw refused()
  } finally {
    await close(file)
  }
}

async function stateDirectory(state, identity) {
  let directory
  try {
    directory = await open(
      state,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    const info = await directory.stat({ bigint: true })
    if (
      !info.isDirectory() ||
      info.uid !== BigInt(process.getuid()) ||
      info.mode & 0o077n ||
      (identity && (identity.dev !== info.dev || identity.ino !== info.ino))
    )
      throw refused()
    return directory
  } catch {
    await directory?.close().catch(() => {})
    throw refused()
  }
}

async function checkState(state, identity) {
  const directory = await stateDirectory(state, identity)
  await close(directory)
}

async function readState(state, identity, name, limit) {
  await checkState(state, identity)
  const bytes = await readBounded(join(state, name), limit, true)
  await checkState(state, identity)
  return bytes
}

async function writeAtomic(state, identity, name, bytes, expected) {
  const directory = await stateDirectory(state, identity)
  const temporary = join(state, `${name}.${randomUUID()}.pending`)
  let file
  try {
    if (!same(expected, await readState(state, identity, name, 256)))
      throw refused()
    file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    await file.writeFile(bytes)
    await file.sync()
    await close(file)
    file = undefined
    if (!same(expected, await readState(state, identity, name, 256)))
      throw refused()
    await rename(temporary, join(state, name))
    await checkState(state, identity)
    await directory.sync()
    await checkState(state, identity)
  } catch {
    throw refused()
  } finally {
    await close(file)
    try {
      // A displaced directory retains its temporary file for diagnosis; never
      // unlink a same-named path in an unrelated replacement directory.
      await checkState(state, identity)
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw refused()
      })
    } finally {
      await close(directory)
    }
  }
}

// These PostgreSQL 18 catalogs cover the public namespace footprint, including
// standalone operators, collations, text-search objects and default privileges.
// Only actual extension members are exempt; sharing their namespace is not
// authority. Database-global objects outside this footprint are not inspected.
const publicCatalogs = [
  ['pg_class', 'relnamespace'],
  ['pg_proc', 'pronamespace'],
  ['pg_type', 'typnamespace'],
  ['pg_collation', 'collnamespace'],
  ['pg_constraint', 'connamespace'],
  ['pg_conversion', 'connamespace'],
  ['pg_operator', 'oprnamespace'],
  ['pg_opclass', 'opcnamespace'],
  ['pg_opfamily', 'opfnamespace'],
  ['pg_statistic_ext', 'stxnamespace'],
  ['pg_ts_config', 'cfgnamespace'],
  ['pg_ts_dict', 'dictnamespace'],
  ['pg_ts_parser', 'prsnamespace'],
  ['pg_ts_template', 'tmplnamespace'],
  ['pg_default_acl', 'defaclnamespace']
]
const emptyPublic = `NOT EXISTS (
  SELECT 1 FROM (
    ${publicCatalogs
      .map(
        ([catalog, namespace]) =>
          `SELECT 'pg_catalog.${catalog}'::regclass AS classid, oid AS objid, ${namespace} AS namespace FROM pg_catalog.${catalog}`
      )
      .join('\n    UNION ALL\n    ')}
  ) o JOIN pg_catalog.pg_namespace n ON n.oid=o.namespace
  WHERE n.nspname='public' AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
    WHERE d.classid=o.classid AND d.objid=o.objid AND d.objsubid=0
      AND d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.refobjsubid=0 AND d.deptype='e'))`

// Preparation runs under the native workspace lock, before initdb. These exact
// retained bytes determine both the digest and the eventual transaction.
export async function prepareSchemaBootstrap({ state, schemaDirectory }) {
  const directory = await stateDirectory(state)
  const { dev, ino } = await directory.stat({ bigint: true })
  const identity = { dev, ino }
  await close(directory)
  const canonical = await readBounded(
    join(schemaDirectory, 'canonical-objects.sql'),
    16 * 1024 * 1024
  )
  const authority = await readBounded(
    join(schemaDirectory, 'authority.sql'),
    16 * 1024 * 1024
  )
  if (!canonical?.length || !authority?.length) throw refused()
  let canonicalSql, authoritySql
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    canonicalSql = decoder.decode(canonical)
    authoritySql = decoder.decode(authority)
    if (canonicalSql.includes('\0') || authoritySql.includes('\0'))
      throw refused()
  } catch {
    throw refused()
  }
  const target = createHash('sha256')
    .update(canonical)
    .update(authority)
    .digest('hex')
  const journalPath = join(state, 'schema-bootstrap.json')
  const marker = await readState(state, identity, 'schema-version', 64)
  if (marker !== undefined && marker.toString() !== target) throw refused()
  let journal = await readState(state, identity, 'schema-bootstrap.json', 256)
  const expectedJournal = JSON.stringify({ format: journalFormat, target })
  // This is our own canonical record, not an interchange document. Exact bytes
  // also refuse duplicate JSON keys and ambiguous alternate serializations.
  if (journal !== undefined && journal.toString() !== expectedJournal)
    throw refused()
  let databaseExists = false
  await checkState(state, identity)
  try {
    const info = await lstat(join(state, 'pgdata'))
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077
    )
      throw refused()
    databaseExists =
      (await readState(state, identity, 'pgdata/PG_VERSION', 32)) !== undefined
    if (!databaseExists && (await readdir(join(state, 'pgdata'))).length)
      throw refused()
  } catch (error) {
    if (error.code !== 'ENOENT') throw refused()
  }
  await checkState(state, identity)
  if (marker && !databaseExists) throw refused()
  if (!databaseExists && !journal) {
    await writeAtomic(state, identity, 'schema-bootstrap.json', expectedJournal)
    journal = Buffer.from(expectedJournal)
  }

  let mode
  const unchangedFiles = async () => {
    const currentMarker = await readState(state, identity, 'schema-version', 64)
    const currentJournal = await readState(
      state,
      identity,
      'schema-bootstrap.json',
      256
    )
    if (!same(marker, currentMarker) || !same(journal, currentJournal))
      throw refused()
  }
  return {
    async inspect(psql) {
      if (mode) throw refused()
      await unchangedFiles()
      let value
      try {
        const result = await psql(`SELECT json_build_object(
          'database',current_database(),'owner',current_user,
          'receipt',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),
          'empty',(${emptyPublic}));`)
        await checkState(state, identity)
        if (typeof result !== 'string' || result.length > 4096) throw refused()
        value = JSON.parse(result)
      } catch {
        throw refused()
      }
      if (
        !value ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !==
          'database,empty,owner,receipt' ||
        value.database !== 'postgres' ||
        value.owner !== 'desktop_owner' ||
        typeof value.empty !== 'boolean'
      )
        throw refused()
      if (value.receipt === receiptPrefix + target && !value.empty)
        mode = 'recover'
      else if (value.receipt !== null && value.receipt !== initdbComment)
        throw refused()
      else if (marker && !journal && !value.empty) mode = 'legacy'
      else if (!marker && journal && value.empty) mode = 'bootstrap'
      else throw refused()
    },
    async complete(psql) {
      try {
        if (!mode || mode === 'complete') throw refused()
        await unchangedFiles()
        if (mode === 'bootstrap') {
          try {
            await psql(`BEGIN;
DO $guard$ BEGIN
IF current_database()<>'postgres' OR current_user<>'desktop_owner' OR
   COALESCE((SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'${initdbComment}')<>'${initdbComment}' OR
   NOT (${emptyPublic}) THEN RAISE EXCEPTION 'Local bootstrap authority required'; END IF;
END $guard$;
${canonicalSql}
${authoritySql}
DO $receipt$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L',current_database(),'${receiptPrefix + target}'); END $receipt$;
COMMIT;`)
          } catch {
            throw refused()
          }
        }
        if (mode !== 'legacy') {
          await unchangedFiles()
          await writeAtomic(state, identity, 'schema-version', target, marker)
          if (journal) {
            if (
              !same(
                journal,
                await readState(state, identity, 'schema-bootstrap.json', 256)
              )
            )
              throw refused()
            await checkState(state, identity)
            await unlink(journalPath)
            const directory = await stateDirectory(state, identity)
            try {
              await directory.sync()
              await checkState(state, identity)
            } finally {
              await close(directory)
            }
          }
        }
        mode = 'complete'
      } catch {
        throw refused()
      }
    }
  }
}

function same(left, right) {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.equals(right)
}
