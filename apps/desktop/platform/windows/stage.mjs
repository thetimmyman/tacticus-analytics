import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat
} from 'node:fs/promises'
import { join, resolve, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export async function inventory(root) {
  const files = []
  async function visit(relative = '') {
    for (const item of await readdir(join(root, relative), {
      withFileTypes: true
    })) {
      const path = relative ? `${relative}/${item.name}` : item.name
      if (
        item.isSymbolicLink() ||
        (await lstat(join(root, path))).isSymbolicLink()
      )
        throw new Error('Package links unsupported')
      if (item.isDirectory()) await visit(path)
      else if (item.isFile()) {
        if (
          /(^|\/)\.env(?:\.|$)|credentials\.json|onboarding\.json|window-config\.json|pgdata\//.test(
            path
          )
        )
          throw new Error('Mutable or secret state found in package')
        const bytes = await readFile(join(root, path))
        files.push({
          path,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        })
      } else throw new Error('Unsupported package entry')
    }
  }
  await visit()
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function stage(config) {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
  for (const field of [
    'output',
    'application',
    'postgres',
    'node',
    'electron',
    'auth',
    'postgrest',
    'native'
  ])
    if (!isAbsolute(config[field] ?? ''))
      throw new Error(`Absolute ${field} path required`)
  if (!/^[a-f0-9]{40}$/.test(config.sourceSha ?? ''))
    throw new Error('Source commit required')
  await mkdir(config.output) // Refuse replacement; activation is the native owner's operation.
  const copy = (input, output) =>
    cp(input, join(config.output, output), {
      recursive: true,
      dereference: false
    })
  await copy(config.application, 'application')
  await copy(config.postgres, 'postgres')
  await mkdir(join(config.output, 'bin'))
  await copy(config.node, 'bin/node.exe')
  await copy(config.electron, 'electron')
  await copy(config.auth, 'auth')
  await mkdir(join(config.output, 'postgrest'))
  await copy(config.postgrest, 'postgrest/postgrest.exe')
  await cp(config.native, config.output, { recursive: true })
  for (const path of [
    'apps/desktop/launcher',
    'apps/desktop/local-schema',
    'packages/workspace-onboarding/v1.mjs',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ])
    await copy(join(source, path), path)
  await mkdir(join(config.output, 'apps/desktop/platform/windows'), {
    recursive: true
  })
  for (const path of [
    'launch.mjs',
    'services.mjs',
    'native-command.mjs',
    'onboarding.mjs',
    'setup.mjs',
    'setup.html',
    'windows-setup.js',
    'windows-style.css',
    'main.cjs'
  ])
    await copy(
      join(source, 'apps/desktop/platform/windows', path),
      `apps/desktop/platform/windows/${path}`
    )
  await mkdir(join(config.output, 'apps/desktop/proof'), { recursive: true })
  for (const path of ['loopback-gateway.mjs', 'synthetic-import.mjs'])
    await copy(
      join(source, 'apps/desktop/proof', path),
      `apps/desktop/proof/${path}`
    )
  const files = await inventory(config.output)
  await writeFile(
    join(config.output, 'bundle-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        platform: 'win-x64',
        sourceSha: config.sourceSha,
        files
      },
      null,
      2
    )
  )
  return {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    candidateOnly: true
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(
      await stage(JSON.parse(await readFile(process.argv[2], 'utf8')))
    )
  )
