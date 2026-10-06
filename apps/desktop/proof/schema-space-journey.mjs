import { strict as assert } from 'node:assert'
import {
  readFile,
  writeFile,
  cp,
  statfs,
  open,
  unlink,
  readdir
} from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const mount = process.argv[3]
assert(isAbsolute(mount || ''), 'A private empty tmpfs directory is required')
const capacity = await statfs(mount)
assert.equal(
  capacity.type,
  0x1021994,
  'The control must run in tmpfs, never on the host data filesystem'
)
assert(
  capacity.blocks * capacity.bsize <= 256 * 1024 * 1024,
  'The control requires a tmpfs no larger than 256 MiB'
)
assert.deepEqual(await readdir(mount), [])
const state = join(mount, 'state'),
  schemaDirectory = join(mount, 'schema')
await cp(config.state, state, {
  recursive: true,
  errorOnExist: true,
  force: false
})
await cp(config.schemaDirectory, schemaDirectory, {
  recursive: true,
  errorOnExist: true,
  force: false
})
const source = await readFile(join(state, 'schema-version'), 'utf8')
assert.match(source, /^[a-f0-9]{64}$/)
const canonical = await readFile(
  join(schemaDirectory, 'canonical-objects.sql'),
  'utf8'
)
const authority =
  (await readFile(join(schemaDirectory, 'authority.sql'), 'utf8')) +
  '\n-- Synthetic space control\n'
await writeFile(join(schemaDirectory, 'authority.sql'), authority)
const target = createHash('sha256')
  .update(canonical)
  .update(authority)
  .digest('hex')
const sql = 'SELECT 1;'
await writeFile(
  join(schemaDirectory, 'migrations/001-feature-catalog-read.sql'),
  sql
)
await writeFile(
  join(schemaDirectory, 'migrations.json'),
  JSON.stringify([
    {
      from: source,
      to: target,
      file: '001-feature-catalog-read.sql',
      sha256: createHash('sha256').update(sql).digest('hex')
    }
  ])
)
const space = await statfs(state),
  filler = join(mount, 'space-reservation')
const reservation = await open(filler, 'wx', 0o600)
try {
  const block = Buffer.alloc(1024 * 1024)
  for (
    let remaining = space.bavail * space.bsize - 8 * 1024 * 1024;
    remaining > 0;
    remaining -= block.length
  )
    await reservation.write(
      block.subarray(0, Math.min(block.length, remaining))
    )
} finally {
  await reservation.close()
}
try {
  await assert.rejects(nativeServices({ ...config, state, schemaDirectory }), {
    code: 'ENOSPC'
  })
  assert.equal(await readFile(join(state, 'schema-version'), 'utf8'), source)
  await assert.rejects(readFile(join(state, 'running.lock')), {
    code: 'ENOENT'
  })
} finally {
  await unlink(filler)
}
const reopened = await nativeServices({ ...config, state })
try {
  assert.equal(
    (await reopened.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '8'
  )
} finally {
  await reopened.stop()
}
const evidence = {
  status: 'passed',
  checks: [
    'checkpoint preparation fails with ENOSPC before schema mutation',
    'original marker preserved and owned journal released',
    'prior schema reopens eight committed synthetic rows'
  ],
  scope:
    'limited tmpfs checkpoint preparation; database-WAL disk exhaustion and physical disk corruption are not covered'
}
if (config.evidence)
  await writeFile(
    config.evidence.replace(/\.json$/, '-schema-space.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
console.log(JSON.stringify(evidence, null, 2))
