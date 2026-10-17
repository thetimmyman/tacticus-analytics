import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile
} from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
for (const key of ['packageRoot', 'stateRoot', 'evidence'])
  assert(isAbsolute(config[key] ?? ''), `Absolute ${key} required`)
const root = config.packageRoot
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const inventory = await readFile(join(root, 'package-inventory.json'))
assert.match(config.packageInventorySha256 ?? '', /^[a-f0-9]{64}$/)
assert.equal(digest(inventory), config.packageInventorySha256)
async function verifyPackage() {
  assert.equal(
    digest(await readFile(join(root, 'package-inventory.json'))),
    digest(inventory)
  )
  const expected = new Map(
    JSON.parse(inventory).files.map((file) => [file.path, file])
  )
  let count = 0
  async function visit(relative = '') {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      const info = await lstat(join(root, path))
      assert.equal(info.isSymbolicLink(), false)
      assert.equal(info.mode & 0o022, 0)
      if (info.isDirectory()) await visit(path)
      else {
        assert(info.isFile())
        assert.equal(info.nlink, 1)
        if (path === 'package-inventory.json') continue
        const file = expected.get(path)
        assert(file, 'Undeclared package file')
        const bytes = await readFile(join(root, path))
        assert.equal(bytes.length, file.bytes)
        assert.equal(digest(bytes), file.sha256)
        count++
      }
    }
  }
  await visit()
  assert.equal(count, expected.size)
}
await verifyPackage()
const nodeExecutable = await realpath(join(root, 'bin/node'))
const load = (file) => import(pathToFileURL(join(root, file)).href)
const { nativeServices: startNativeServices } = await load(
  'apps/desktop/proof/native-services.mjs'
)
// Keep the existing coordinator/guard ownership chain; only the Node executable
// selected by the service owner changes from the trusted driver to the bundle.
const nativeServices = (options) =>
  startNativeServices(options, { nodeExecutable })
const { bundledServices } = await load('apps/desktop/launcher/runtime.mjs')
const { workspaceSetup } = await load('apps/desktop/launcher/workspace.mjs')
const { guardedEncryptedTransfer } = await load(
  'apps/desktop/launcher/maintenance.mjs'
)
const { saveScopedConnections, loadScopedConnections } = await load(
  'apps/desktop/launcher/scoped-connections.mjs'
)
const { loadGameConnection } = await load(
  'apps/desktop/launcher/saved-game-connection.mjs'
)
const folder = join(config.stateRoot, `encrypted-transfer-${randomUUID()}`)
await mkdir(folder, { recursive: true, mode: 0o700 })
const state = join(folder, 'source')
const backup = join(folder, 'workspace.tabackup')
const restored = join(folder, 'restored')
const passphrase = randomBytes(32)
const canary = 'SYNTHETIC-EXCLUDED-VAULT-CANARY'
const checks = []
const tables = [
  'EOT_GR_data',
  'desktop_preview_setup',
  'player_mapping',
  'player_roster',
  'guild_raid_season_plans'
]
async function snapshot(services) {
  const result = {}
  for (const table of tables)
    result[table] = JSON.parse(
      (
        await services.psql(
          `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public."${table}" t;`
        )
      ).trim()
    )
  return result
}
async function emptyTarget(name) {
  const target = join(folder, name)
  await mkdir(target, { mode: 0o700 })
  return target
}
async function refusedRestore(name, file, key) {
  const target = await emptyTarget(name)
  await assert.rejects(
    guardedEncryptedTransfer(root, 'restore', target, file, key)
  )
  assert.deepEqual(await readdir(target), ['runtime.lease'])
}
let services, listener, before
try {
  services = await nativeServices(bundledServices(root, state))
  const handler = workspaceSetup(services, join(root, 'apps/desktop/launcher'))
  listener = createServer((req, res) => {
    void handler(req, res, new URL(req.url, 'http://127.0.0.1')).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const setup = await fetch(
    `http://127.0.0.1:${listener.address().port}/desktop/setup`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sample: true }),
      signal: AbortSignal.timeout(30000)
    }
  )
  assert.equal(setup.status, 201)
  await setup.arrayBuffer()
  await new Promise((resolve) => listener.close(resolve))
  listener = undefined
  await services.psql(`
    INSERT INTO public.player_roster(user_id,player_mapping_id,rank_name,xp,xp_level,shards)
      SELECT s.subject_user_id,p.id,'Stone I',1234,12,34
      FROM public.desktop_preview_setup s JOIN public.player_mapping p ON p.user_id=s.subject_user_id
      WHERE p.is_current LIMIT 1;
    INSERT INTO public.guild_raid_season_plans(guild_code,season_id,start_at,end_at,kind,baseline_key,plan,created_by)
      SELECT guild_code,'9999','2030-01-01T00:00:00Z','2030-01-14T00:00:00Z','baseline','synthetic-backup',
      '{"season":9999,"stages":[{"boss":"SyntheticBoss","tokens":12}]}'::jsonb,subject_user_id
      FROM public.desktop_preview_setup;
  `)
  before = await snapshot(services)
  assert.equal(before.EOT_GR_data.length, 8)
  assert.equal(before.player_roster.length, 1)
  assert.equal(before.guild_raid_season_plans.length, 1)
  const owner = before.desktop_preview_setup[0].subject_user_id
  await saveScopedConnections(state, {
    format: 'ta-scoped-official-access-v1',
    installation: owner,
    guildCode: 'SYN001',
    roles: {
      Player: { handle: 'a'.repeat(32), verifiedAt: Date.UTC(2030, 0, 1) }
    }
  })
  assert.ok(await loadScopedConnections(state))
  await mkdir(join(state, 'game-vault'), { mode: 0o700 })
  await writeFile(join(state, 'game-vault/canary'), canary, { mode: 0o600 })
  await assert.rejects(
    guardedEncryptedTransfer(root, 'backup', state, backup, passphrase),
    /in use/
  )
  assert.deepEqual(await snapshot(services), before)
  checks.push(
    'active-workspace encrypted backup refused without changing domain data'
  )
  await services.stop()
  services = undefined
  await guardedEncryptedTransfer(root, 'backup', state, backup, passphrase)
  const bytes = await readFile(backup)
  assert.equal(bytes.subarray(0, 8).toString(), 'TABKENC2')
  assert.equal(bytes.includes(Buffer.from(canary)), false)
  assert.equal(
    bytes.includes(await readFile(join(state, 'credentials.json'))),
    false
  )
  await assert.rejects(
    guardedEncryptedTransfer(root, 'backup', state, backup, passphrase)
  )
  assert.equal(digest(await readFile(backup)), digest(bytes))
  checks.push(
    'encrypted v2 backup excludes plaintext canaries and refuses destination replacement'
  )
  const wrong = randomBytes(32)
  try {
    await refusedRestore('wrong-passphrase', backup, wrong)
  } finally {
    wrong.fill(0)
  }
  const corrupted = Buffer.from(bytes)
  corrupted[corrupted.length - 1] ^= 1
  const damaged = join(folder, 'corrupt.tabackup')
  await writeFile(damaged, corrupted, { mode: 0o600 })
  await refusedRestore('corrupt-target', damaged, passphrase)
  const incompatible = Buffer.from(bytes)
  incompatible[0] ^= 1
  const unknown = join(folder, 'unknown-format.tabackup')
  await writeFile(unknown, incompatible, { mode: 0o600 })
  await refusedRestore('unknown-format-target', unknown, passphrase)
  checks.push(
    'wrong passphrase, corrupt ciphertext and unsupported header leave no restored files'
  )
  await mkdir(restored, { mode: 0o700 })
  await guardedEncryptedTransfer(root, 'restore', restored, backup, passphrase)
  assert.equal(await loadScopedConnections(restored), null)
  assert.equal(await loadGameConnection(restored), null)
  await assert.rejects(readFile(join(restored, 'game-vault/canary')), {
    code: 'ENOENT'
  })
  checks.push(
    'restored workspace has no game vault or saved live connection authority'
  )
  services = await nativeServices(bundledServices(root, restored))
  assert.deepEqual(await snapshot(services), before)
  await services.stop()
  services = undefined
  await assert.rejects(
    guardedEncryptedTransfer(root, 'restore', restored, backup, passphrase)
  )
  const schema = await readFile(join(restored, 'schema-version'))
  await writeFile(join(restored, 'schema-version'), 'incompatible', {
    mode: 0o600
  })
  await assert.rejects(
    nativeServices(bundledServices(root, restored)),
    /Incompatible local schema/
  )
  await writeFile(join(restored, 'schema-version'), schema, { mode: 0o600 })
  services = await nativeServices(bundledServices(root, restored))
  assert.deepEqual(await snapshot(services), before)
  await services.stop()
  services = await nativeServices(bundledServices(root, state))
  assert.deepEqual(await snapshot(services), before)
  assert.ok(await loadScopedConnections(state))
  checks.push(
    'raid history, owner, roster and saved plan survive restore, refusal and both reopens'
  )
  await verifyPackage()
  checks.push(
    'complete declared package inventory is unchanged before and after the journey'
  )
  await writeFile(
    config.evidence.replace('.json', '-encrypted-transfer.json'),
    JSON.stringify(
      {
        packageInventorySha256: digest(inventory),
        backupSha256: digest(bytes),
        domainSha256: digest(JSON.stringify(before)),
        checks,
        scope:
          'Bundled Linux native services and encrypted transfer; synthetic data, same installation identity. Inventory checks are before/after snapshots under a trusted driver without a concurrent package writer, not hostile same-user continuous-code custody. Native dialogs, fresh-install key rotation and consumer installation are separate gates.'
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    JSON.stringify({
      gate: 'encrypted-workspace-transfer',
      checks,
      status: 'passed'
    })
  )
} finally {
  passphrase.fill(0)
  if (listener) await new Promise((resolve) => listener.close(resolve))
  await services?.stop()
}
