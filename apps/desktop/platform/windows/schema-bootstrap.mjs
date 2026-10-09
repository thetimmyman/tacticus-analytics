import { open, lstat, readdir, rename, unlink } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const journalFormat = 'desktop-windows-schema-bootstrap/v1'
// Preserve the transaction receipt used by existing Windows workspaces.
const receiptPrefix = 'desktop-schema:'
const initdbComment = 'default administrative connection database'
const refused = () =>
  Object.assign(
    new Error('Local schema state is incompatible; activation refused'),
    { code: 'ESCHEMA' }
  )

async function close(file) {
  try {
    await file?.close()
  } catch {
    throw refused()
  }
}

// The native owner admits the ACL and all reparse ancestors and holds its OS
// workspace lock. These observations supplement that admission; they are not
// a substitute for it or protection against hostile same-user path races.
async function directories(path) {
  for (let current = path; ; current = dirname(current)) {
    const info = await lstat(current, { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink()) throw refused()
    if (current === dirname(current)) return
  }
}

function identity(info) {
  // Node's Windows libuv adapter reports VolumeSerialNumber and FileId here.
  // Keep opaque bigint values; Windows ACLs cannot be inferred from mode/uid.
  if (
    typeof info.dev !== 'bigint' ||
    typeof info.ino !== 'bigint' ||
    info.ino === 0n
  )
    throw refused()
  return { volume: info.dev, file: info.ino }
}

function sameIdentity(left, right) {
  return left.volume === right.volume && left.file === right.file
}

async function checkState(state, expected) {
  try {
    await directories(state)
    const info = await lstat(state, { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink()) throw refused()
    const current = identity(info)
    if (expected && !sameIdentity(expected, current)) throw refused()
    return current
  } catch {
    throw refused()
  }
}

async function readBounded(path, limit) {
  let before
  try {
    await directories(dirname(path))
    before = await lstat(path, { bigint: true })
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw refused()
  }
  let file
  try {
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size > BigInt(limit)
    )
      throw refused()
    const expected = identity(before)
    file = await open(path, 'r')
    const opened = await file.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.size > BigInt(limit) ||
      !sameIdentity(expected, identity(opened))
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
    const after = await lstat(path, { bigint: true })
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.nlink !== 1n ||
      !sameIdentity(expected, identity(after))
    )
      throw refused()
    return bytes.subarray(0, size)
  } catch {
    throw refused()
  } finally {
    await close(file)
  }
}

async function readState(state, expected, name, limit) {
  await checkState(state, expected)
  const bytes = await readBounded(join(state, name), limit)
  await checkState(state, expected)
  return bytes
}

async function writeAtomic(state, expectedState, name, bytes, expectedBytes) {
  // Flush the file before same-directory rename. Recovery covers interrupted
  // processes under the native lock; it does not promise power-loss durability.
  const temporary = join(state, `${name}.${randomUUID()}.pending`)
  let file, temporaryIdentity
  try {
    if (!same(expectedBytes, await readState(state, expectedState, name, 256)))
      throw refused()
    file = await open(temporary, 'wx')
    temporaryIdentity = identity(await file.stat({ bigint: true }))
    await file.writeFile(bytes)
    await file.sync()
    await close(file)
    file = undefined
    if (!same(expectedBytes, await readState(state, expectedState, name, 256)))
      throw refused()
    await rename(temporary, join(state, name))
    await checkState(state, expectedState)
    if (
      !same(
        Buffer.from(bytes),
        await readState(state, expectedState, name, 256)
      )
    )
      throw refused()
  } catch {
    throw refused()
  } finally {
    await close(file)
    // Do not delete a temporary path inside a displaced or replacement state.
    await checkState(state, expectedState)
    if (temporaryIdentity) {
      try {
        const remaining = await lstat(temporary, { bigint: true })
        if (
          !remaining.isFile() ||
          remaining.isSymbolicLink() ||
          !sameIdentity(temporaryIdentity, identity(remaining))
        )
          throw refused()
        await unlink(temporary)
      } catch (error) {
        if (error.code !== 'ENOENT') throw refused()
      }
    }
  }
}

// PostgreSQL 18 namespace footprint. Only actual extension members are exempt;
// database-global objects outside these catalogs are not inspected.
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

// Call under the existing native ProtectedState lock, before initdb or service
// material changes. Retained SQL bytes own both the digest and transaction.
export async function prepareSchemaBootstrap({ state, schemaDirectory }) {
  if (typeof state !== 'string' || typeof schemaDirectory !== 'string')
    throw refused()
  state = resolve(state)
  schemaDirectory = resolve(schemaDirectory)
  const expectedState = await checkState(state)
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
  const marker = await readState(state, expectedState, 'schema-version', 64)
  if (marker !== undefined && marker.toString() !== target) throw refused()
  let journal = await readState(
    state,
    expectedState,
    'schema-bootstrap.json',
    256
  )
  const expectedJournal = JSON.stringify({ format: journalFormat, target })
  if (journal !== undefined && journal.toString() !== expectedJournal)
    throw refused()
  let databaseExists = false
  await checkState(state, expectedState)
  try {
    const info = await lstat(join(state, 'pgdata'), { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink()) throw refused()
    const version = await readState(
      state,
      expectedState,
      'pgdata/PG_VERSION',
      32
    )
    if (version !== undefined) {
      if (!/^18(?:\r?\n)?$/.test(version.toString())) throw refused()
      databaseExists = true
    } else if ((await readdir(join(state, 'pgdata'))).length) throw refused()
  } catch (error) {
    if (error.code !== 'ENOENT') throw refused()
  }
  await checkState(state, expectedState)
  if (marker && !databaseExists) throw refused()
  if (!databaseExists && !journal) {
    await writeAtomic(
      state,
      expectedState,
      'schema-bootstrap.json',
      expectedJournal
    )
    journal = Buffer.from(expectedJournal)
  }
  let mode
  const unchanged = async () => {
    if (
      !same(
        marker,
        await readState(state, expectedState, 'schema-version', 64)
      ) ||
      !same(
        journal,
        await readState(state, expectedState, 'schema-bootstrap.json', 256)
      )
    )
      throw refused()
  }
  return {
    async inspect(psql) {
      if (mode) throw refused()
      await unchanged()
      let value
      try {
        const result = await psql(`SELECT json_build_object(
          'database',current_database(),'owner',current_user,
          'receipt',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),
          'empty',(${emptyPublic}));`)
        await checkState(state, expectedState)
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
        await unchanged()
        if (mode === 'bootstrap') {
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
        }
        if (mode !== 'legacy') {
          await unchanged()
          await writeAtomic(
            state,
            expectedState,
            'schema-version',
            target,
            marker
          )
          if (journal) {
            if (
              !same(
                journal,
                await readState(
                  state,
                  expectedState,
                  'schema-bootstrap.json',
                  256
                )
              )
            )
              throw refused()
            await checkState(state, expectedState)
            await unlink(join(state, 'schema-bootstrap.json'))
            await checkState(state, expectedState)
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
