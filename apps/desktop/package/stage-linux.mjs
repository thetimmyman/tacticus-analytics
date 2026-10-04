import { cp, mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { resolve, join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
for (const name of [
  'output',
  'application',
  'postgres',
  'node',
  'electron',
  'auth',
  'postgrest',
  'runtimeGuard',
  'nodeLicense',
  'authLicense',
  'postgrestLicense'
])
  if (!isAbsolute(config[name] || ''))
    throw new Error(`Absolute ${name} path required`)
try {
  await stat(config.output)
  throw new Error('Package output already exists')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await mkdir(config.output, { recursive: true, mode: 0o700 })
const copy = (from, to) =>
  cp(from, join(config.output, to), { recursive: true, dereference: true })
await copy(config.application, 'application')
await copy(config.postgres, 'postgres')
await mkdir(join(config.output, 'bin'))
await copy(config.node, 'bin/node')
await copy(config.runtimeGuard, 'bin/runtime-guard')
await copy(config.electron, 'electron')
await mkdir(join(config.output, 'auth'))
await copy(join(config.auth, 'auth'), 'auth/auth')
await copy(join(config.auth, 'migrations'), 'auth/migrations')
await mkdir(join(config.output, 'postgrest'))
await copy(config.postgrest, 'postgrest/postgrest')
await mkdir(join(config.output, 'notices'))
for (const [from, name] of [
  [config.nodeLicense, 'node-LICENSE'],
  [config.authLicense, 'supabase-auth-LICENSE'],
  [config.postgrestLicense, 'postgrest-LICENSE'],
  [join(config.postgres, 'COPYRIGHT'), 'postgresql-COPYRIGHT'],
  [join(config.electron, 'LICENSE'), 'electron-LICENSE'],
  [join(config.electron, 'LICENSES.chromium.html'), 'LICENSES.chromium.html']
]) {
  const notice = await readFile(from)
  if (!notice.length)
    throw new Error('A bundled component notice is missing or empty')
  await writeFile(join(config.output, 'notices', name), notice, { mode: 0o600 })
}
for (const path of [
  'apps/desktop/launcher',
  'apps/desktop/local-schema',
  'apps/desktop/runtime-inputs.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md'
])
  await copy(join(source, path), path)
await mkdir(join(config.output, 'apps/desktop/proof'))
for (const file of [
  'native-services.mjs',
  'service-owner.mjs',
  'service-client.mjs',
  'loopback-gateway.mjs',
  'synthetic-import.mjs',
  'renderer-wake.cjs'
])
  await copy(
    join(source, 'apps/desktop/proof', file),
    join('apps/desktop/proof', file)
  )
await writeFile(
  join(config.output, 'launch'),
  `#!/bin/sh\npackage_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$package_dir/bin/node" "$package_dir/apps/desktop/launcher/launch.mjs" "$@"\n`,
  { mode: 0o755 }
)
const inventory = []
async function visit(path = '') {
  for (const entry of await readdir(join(config.output, path), {
    withFileTypes: true
  })) {
    const name = join(path, entry.name)
    if (entry.isDirectory()) await visit(name)
    else if (entry.isFile()) {
      if (
        /(^|\/)\.env(?:\.|$)|credentials\.json|workspace-owner\.json|pgdata\//.test(
          name
        )
      )
        throw new Error('Mutable state or environment file found in package')
      const bytes = await readFile(join(config.output, name))
      inventory.push({
        path: name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      })
    } else throw new Error('Non-file package entry is unsupported')
  }
}
await visit()
await writeFile(
  join(config.output, 'package-inventory.json'),
  JSON.stringify(
    {
      platform: 'linux-x64',
      kind: 'private-synthetic-preview',
      files: inventory,
      totalBytes: inventory.reduce((total, file) => total + file.bytes, 0)
    },
    null,
    2
  )
)
console.log(
  JSON.stringify({
    files: inventory.length,
    bytes: inventory.reduce((total, file) => total + file.bytes, 0)
  })
)
