import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const ADDON_BUNDLES = [
  {
    path: 'native-runtime.cjs',
    options: {
      entryPoints: ['apps/addons/native-runtime.ts'],
      format: 'cjs',
      target: 'node22',
      platform: 'node'
    }
  },
  {
    path: 'native-manager.js',
    options: {
      entryPoints: ['apps/addons/native-manager.tsx'],
      format: 'iife',
      target: 'es2022',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' }
    }
  }
]

// Bundle the add-ons in memory. Nothing is written to disk, so callers decide where the
// bytes go and can write them through a directory they already hold.
export async function bundleNativeAddons() {
  const outputs = []
  for (const { path, options } of ADDON_BUNDLES) {
    const result = await build({
      ...options,
      absWorkingDir: root,
      outfile: path,
      bundle: true,
      sourcemap: false,
      write: false
    })
    if (result.outputFiles?.length !== 1)
      throw new Error(
        `Native add-on bundle produced unexpected output: ${path}`
      )
    outputs.push({
      path,
      contents: Buffer.from(result.outputFiles[0].contents)
    })
  }
  const files = outputs.map(({ path, contents }) => ({
    path,
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex')
  }))
  outputs.push({
    path: 'native-components.json',
    contents: Buffer.from(
      JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n'
    )
  })
  return { files, outputs }
}

export async function buildNativeAddons(output) {
  const { files, outputs } = await bundleNativeAddons()
  await mkdir(output, { recursive: true, mode: 0o700 })
  for (const { path, contents } of outputs)
    await writeFile(join(output, path), contents)
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
