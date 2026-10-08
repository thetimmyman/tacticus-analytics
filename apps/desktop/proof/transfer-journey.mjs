import { strict as assert } from 'node:assert'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  'workspace-transfer.mjs'
)
const folder = join(config.stateRoot, `transfer-${randomUUID()}`)
await mkdir(folder, { recursive: true, mode: 0o700 })
const transfer = (operation, state, other) =>
  new Promise((accept, reject) => {
    const child = spawn(
      config.runtimeGuard,
      ['--owner', state, process.execPath, script, operation, state, other],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }
      }
    )
    child.once('error', reject)
    child.once('exit', accept)
  })
const backup = join(folder, 'backup'),
  restored = join(folder, 'restored')
let services = await nativeServices(config)
let rows, ledger
try {
  rows = (
    await services.psql(
      'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
    )
  ).trim()
  assert.equal(JSON.parse(rows).length, 8)
  ledger = (
    await services.psql(
      "SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.desktop_preview_setup s;"
    )
  ).trim()
  assert.equal(await transfer('backup', config.state, backup), 73)
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '8'
  )
} finally {
  await services.stop()
}
const credentials = await readFile(join(config.state, 'credentials.json'))
await mkdir(join(config.state, 'addons'), { mode: 0o700 })
await writeFile(
  join(config.state, 'addons/registry.json'),
  JSON.stringify({ schemaVersion: 1, modules: {}, data: {} }),
  { mode: 0o600 }
)
await mkdir(join(config.state, 'game-vault'), { mode: 0o700, recursive: true })
await writeFile(
  join(config.state, 'game-vault/synthetic-key'),
  'SYNTHETIC-VAULT-CANARY',
  { mode: 0o600 }
)
assert.equal(await transfer('backup', config.state, backup), 0)
assert.equal(
  JSON.parse(await readFile(join(backup, 'checkpoint.json'))).format,
  'desktop-stopped-checkpoint-v2'
)
await assert.rejects(readFile(join(backup, 'game-vault/synthetic-key')), {
  code: 'ENOENT'
})
const manifest = await readFile(join(backup, 'checkpoint.json'))
assert.equal(await transfer('backup', config.state, backup), 1)
assert((await readFile(join(backup, 'checkpoint.json'))).equals(manifest))
await mkdir(restored, { mode: 0o700 })
assert.equal(await transfer('restore', restored, backup), 0)
assert((await readFile(join(restored, 'credentials.json'))).equals(credentials))
assert(
  (await readFile(join(restored, 'addons/registry.json'))).equals(
    await readFile(join(config.state, 'addons/registry.json'))
  )
)
services = await nativeServices({ ...config, state: restored })
try {
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim(),
    rows
  )
  assert.equal(
    (
      await services.psql(
        "SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.desktop_preview_setup s;"
      )
    ).trim(),
    ledger
  )
} finally {
  await services.stop()
}
assert.equal(await transfer('restore', restored, backup), 1)
const corrupted = join(folder, 'corrupted')
await cp(backup, corrupted, {
  recursive: true,
  errorOnExist: true,
  force: false
})
await writeFile(join(corrupted, 'pgdata/PG_VERSION'), 'corrupt', {
  mode: 0o600
})
const rejected = join(folder, 'rejected')
await mkdir(rejected, { mode: 0o700 })
assert.equal(await transfer('restore', rejected, corrupted), 1)
const interrupted = join(folder, 'interrupted')
await mkdir(interrupted, { mode: 0o700 })
await writeFile(join(interrupted, 'restore.pending.json'), '{}', {
  mode: 0o600
})
await assert.rejects(
  nativeServices({ ...config, state: interrupted }),
  /Incompatible local schema/
)
assert(
  (await readFile(join(config.state, 'credentials.json'))).equals(credentials)
)
const evidence = {
  status: 'passed',
  checks: [
    'active source kernel lease rejects export without disturbing database',
    'stopped checkpoint exports and verifies exact file hashes',
    'existing backup and workspace refused without replacement',
    'restored native database preserves eight rows, setup ledger and credential identity',
    'module data is included while the synthetic game-vault canary is excluded',
    'corrupted backup rejected before copying',
    'pending restore refuses bootstrap and application activation'
  ],
  scope:
    'same-installation physical PostgreSQL checkpoint; source credentials preserved; not cross-version database conversion or game-secret vault backup'
}
await writeFile(
  config.evidence.replace('.json', '-transfer.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
