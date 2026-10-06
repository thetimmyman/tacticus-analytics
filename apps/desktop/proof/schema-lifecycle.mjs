import {
  readFile,
  mkdir,
  rename,
  open,
  readdir,
  lstat,
  statfs,
  unlink
} from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withEntry, copyRegularTree } from './safe-files.mjs'

const hashPattern = /^[a-f0-9]{64}$/
const pendingFormat = 'desktop-schema-transition-v1'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const incompatible = () =>
  new Error('Incompatible local schema; activation refused')
export async function writeAtomic(path, value) {
  const temp = `${path}.${randomUUID()}.pending`
  try {
    const file = await open(temp, 'wx', 0o600)
    try {
      await file.writeFile(value)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temp, path)
    const directory = await open(dirname(path), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}
export async function inventory(root, prefix = '') {
  async function walk(directory, prefix) {
    const result = []
    const anchor = `/proc/self/fd/${directory.fd}`
    for (const name of (await readdir(anchor)).sort()) {
      const relative = join(prefix, name)
      await withEntry(join(anchor, name), async (file, info) => {
        if (info.isDirectory()) result.push(...(await walk(file, relative)))
        else {
          const hash = createHash('sha256')
          let bytes = 0
          for await (const block of file.createReadStream({
            autoClose: false
          })) {
            hash.update(block)
            bytes += block.length
          }
          result.push({ path: relative, bytes, sha256: hash.digest('hex') })
        }
      })
    }
    return result
  }
  return withEntry(root, async (directory, metadata) => {
    if (!metadata.isDirectory())
      throw new Error('Checkpoint root must be a real directory')
    return walk(directory, prefix)
  })
}
export async function syncTree(root) {
  await withEntry(root, async (file, metadata, anchor) => {
    if (metadata.isDirectory())
      for (const name of await readdir(anchor))
        await syncTree(join(anchor, name))
    await file.sync()
  })
}
export async function checkpoint(state, source) {
  const id = randomUUID()
  const parent = join(state, 'backups')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  return withEntry(parent, async (parentFile, folder, anchor) => {
    if (
      !folder.isDirectory() ||
      folder.mode & 0o077 ||
      folder.uid !== process.getuid()
    )
      throw new Error('Checkpoint directory must be private')
    const inputs = ['pgdata', 'credentials.json', 'schema-version']
    const database = await inventory(join(state, 'pgdata'))
    const estimate = database.reduce(
      (total, file) => total + BigInt(file.bytes),
      0n
    )
    const space = await statfs(state, { bigint: true })
    if (space.bavail * space.bsize < estimate + 16n * 1024n * 1024n)
      throw Object.assign(
        new Error('Insufficient space for schema checkpoint'),
        {
          code: 'ENOSPC'
        }
      )
    const destination = join(anchor, `${id}.pending`)
    await mkdir(destination, { mode: 0o700 })
    for (const input of inputs)
      await copyRegularTree(join(state, input), join(destination, input))
    const files = await inventory(destination)
    await syncTree(destination)
    await writeAtomic(
      join(destination, 'checkpoint.json'),
      JSON.stringify({ format: 'desktop-stopped-checkpoint-v1', source, files })
    )
    await rename(destination, join(anchor, id))
    await parentFile.sync()
    return id
  })
}

export async function prepareSchema({
  state,
  schemaDirectory,
  target,
  databaseMajor = 18
}) {
  if (!hashPattern.test(target)) throw incompatible()
  for (const marker of ['restore.pending.json', 'backup.pending.json']) {
    try {
      await lstat(join(state, marker))
      throw incompatible()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  let databaseVersion
  try {
    databaseVersion = await readFile(join(state, 'pgdata/PG_VERSION'), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (
    databaseVersion !== undefined &&
    databaseVersion.trim() !== String(databaseMajor)
  )
    throw incompatible()
  let migrations = []
  try {
    migrations = JSON.parse(
      await readFile(join(schemaDirectory, 'migrations.json'), 'utf8')
    )
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!Array.isArray(migrations)) throw incompatible()
  if (new Set(migrations.map((item) => item.from)).size !== migrations.length)
    throw incompatible()
  for (const migration of migrations) {
    if (
      !hashPattern.test(migration.from) ||
      migration.to !== target ||
      !hashPattern.test(migration.sha256) ||
      !/^[a-z0-9-]+\.sql$/.test(migration.file)
    )
      throw incompatible()
    const sql = await readFile(
      join(schemaDirectory, 'migrations', migration.file),
      'utf8'
    )
    if (digest(sql) !== migration.sha256) throw incompatible()
  }
  const marker = join(state, 'schema-version')
  let value
  try {
    value = await readFile(marker, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (value === target) return { kind: 'current', target }
  if (value === undefined) {
    try {
      await lstat(join(state, 'pgdata/PG_VERSION'))
      throw incompatible()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const transition = {
      format: pendingFormat,
      from: null,
      to: target,
      backup: null,
      migrationFile: null,
      migrationSha256: null
    }
    await writeAtomic(marker, JSON.stringify(transition))
    return { kind: 'bootstrap', target, transition }
  }
  if (hashPattern.test(value)) {
    const migration = migrations.find((item) => item.from === value)
    if (!migration) throw incompatible()
    const backup = await checkpoint(state, value)
    const transition = {
      format: pendingFormat,
      from: value,
      to: target,
      backup,
      migrationFile: migration.file,
      migrationSha256: migration.sha256
    }
    await writeAtomic(marker, JSON.stringify(transition))
    return { kind: 'upgrade', target, migration, transition }
  }
  let transition
  try {
    transition = JSON.parse(value)
  } catch {
    throw incompatible()
  }
  if (transition.format !== pendingFormat || transition.to !== target)
    throw incompatible()
  if (
    transition.from === null &&
    transition.backup === null &&
    transition.migrationFile === null &&
    transition.migrationSha256 === null
  )
    return { kind: 'bootstrap', target, transition }
  if (
    !hashPattern.test(transition.from) ||
    !/^[a-f0-9-]{36}$/.test(transition.backup || '')
  )
    throw incompatible()
  const migration = migrations.find((item) => item.from === transition.from)
  if (!migration) throw incompatible()
  if (
    transition.migrationFile !== migration.file ||
    transition.migrationSha256 !== migration.sha256
  )
    throw incompatible()
  const saved = JSON.parse(
    await readFile(
      join(state, 'backups', transition.backup, 'checkpoint.json'),
      'utf8'
    )
  )
  if (
    saved.format !== 'desktop-stopped-checkpoint-v1' ||
    saved.source !== transition.from
  )
    throw incompatible()
  const actual = (
    await inventory(join(state, 'backups', transition.backup))
  ).filter((file) => file.path !== 'checkpoint.json')
  if (JSON.stringify(actual) !== JSON.stringify(saved.files))
    throw new Error('Schema checkpoint is incomplete or changed')
  return { kind: 'upgrade', target, migration, transition }
}
export async function completeSchema({
  state,
  schemaDirectory,
  plan,
  psql,
  bootstrapSql
}) {
  const exists =
    (
      await psql(
        "SELECT to_regclass('public.desktop_runtime_schema') IS NOT NULL;"
      )
    ).trim() === 't'
  const current = exists
    ? (
        await psql(
          'SELECT schema_hash FROM public.desktop_runtime_schema WHERE id;'
        )
      ).trim()
    : null
  if (current === plan.target) {
    await writeAtomic(join(state, 'schema-version'), plan.target)
    return { recovered: true }
  }
  if (plan.kind === 'current' || (current && current !== plan.transition.from))
    throw incompatible()
  let sql = bootstrapSql
  if (plan.kind === 'upgrade') {
    sql = await readFile(
      join(schemaDirectory, 'migrations', plan.migration.file),
      'utf8'
    )
    if (digest(sql) !== plan.migration.sha256) throw incompatible()
  }
  if (!sql) throw incompatible()
  const source = plan.transition.from ? `'${plan.transition.from}'` : 'NULL'
  const id =
    plan.kind === 'bootstrap' ? 'bootstrap' : plan.migration.file.slice(0, -4)
  const migrationDigest =
    plan.kind === 'bootstrap' ? 'NULL' : `'${plan.migration.sha256}'`
  await psql(`BEGIN;
DO $guard$ BEGIN IF current_database() <> 'postgres' OR current_user <> 'desktop_owner' THEN RAISE EXCEPTION 'Local schema authority required'; END IF; END $guard$;
${sql}
CREATE TABLE IF NOT EXISTS public.desktop_runtime_schema (id boolean PRIMARY KEY DEFAULT true CHECK(id), schema_hash text NOT NULL CHECK(schema_hash ~ '^[a-f0-9]{64}$'), migration_id text NOT NULL, migration_sha256 text CHECK(migration_sha256 ~ '^[a-f0-9]{64}$'));
REVOKE ALL ON public.desktop_runtime_schema FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
DO $receipt$ DECLARE old_hash text; BEGIN
SELECT schema_hash INTO old_hash FROM public.desktop_runtime_schema WHERE id FOR UPDATE;
IF old_hash IS NOT NULL AND old_hash IS DISTINCT FROM ${source} THEN RAISE EXCEPTION 'Schema receipt mismatch'; END IF;
INSERT INTO public.desktop_runtime_schema(id,schema_hash,migration_id,migration_sha256) VALUES(true,'${plan.target}','${id}',${migrationDigest}) ON CONFLICT(id) DO UPDATE SET schema_hash=excluded.schema_hash,migration_id=excluded.migration_id,migration_sha256=excluded.migration_sha256;
END $receipt$;
COMMIT;`)
  await writeAtomic(join(state, 'schema-version'), plan.target)
  return { recovered: false }
}
