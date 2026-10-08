import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export async function buildNativeAddons(output) {
  await mkdir(output, { recursive: true, mode: 0o700 })
  await build({
    absWorkingDir: root,
    entryPoints: ['apps/addons/native-runtime.ts'],
    outfile: join(output, 'native-runtime.cjs'),
    bundle: true,
    format: 'cjs',
    target: 'node22',
    platform: 'node',
    sourcemap: false
  })
  await build({
    absWorkingDir: root,
    entryPoints: ['apps/addons/native-manager.tsx'],
    outfile: join(output, 'native-manager.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' }
  })
  const files = []
  for (const path of ['native-runtime.cjs', 'native-manager.js']) {
    const bytes = await readFile(join(output, path))
    files.push({
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }
  await writeFile(
    join(output, 'native-components.json'),
    JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n'
  )
  return files
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2]?.startsWith('/'))
    throw new Error('Absolute output path required')
  console.log(JSON.stringify(await buildNativeAddons(process.argv[2])))
}
