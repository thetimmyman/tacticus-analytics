import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.argv[2]
if (!out || !isAbsolute(out))
  throw new Error('Provide an absolute output directory')
await mkdir(out, { recursive: true, mode: 0o700 })
const nodeOptions = {
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  target: 'node22',
  platform: 'node',
  preserveSymlinks: true,
  sourcemap: false
}
await build({
  ...nodeOptions,
  entryPoints: ['packages/addon-host/src/index.ts'],
  outfile: join(out, 'addon-host.mjs')
})
await build({
  ...nodeOptions,
  entryPoints: ['apps/addons/commands.ts'],
  outfile: join(out, 'commands.mjs')
})
await build({
  absWorkingDir: root,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  preserveSymlinks: true,
  sourcemap: false,
  external: ['react', 'react/jsx-runtime'],
  entryPoints: ['apps/addons/AddonManager.tsx'],
  outfile: join(out, 'manager.mjs')
})
const components = []
for (const path of ['addon-host.mjs', 'commands.mjs', 'manager.mjs']) {
  const bytes = await readFile(join(out, path))
  components.push({
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
}
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
}).trim()
const dirty =
  execFileSync(
    'git',
    ['status', '--porcelain', '--', 'packages/addon-host', 'apps/addons'],
    { cwd: root, encoding: 'utf8' }
  ).trim().length > 0
await writeFile(
  join(out, 'component-manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceSha,
      sourceDirty: dirty,
      runtime: process.version,
      artifactType: 'builtin-addon-components',
      releaseApproved: false,
      components
    },
    null,
    2
  ) + '\n',
  { mode: 0o600 }
)
process.stdout.write(
  JSON.stringify({
    sourceSha,
    sourceDirty: dirty,
    components: components.map(({ path, sha256 }) => ({ path, sha256 }))
  }) + '\n'
)
