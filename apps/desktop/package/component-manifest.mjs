import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

/**
 * Gate (d) proof: emit a (component, version, license, sha256) manifest
 * for the bundled native components and verify it against a committed
 * expected manifest. Operates on a components.json descriptor; see
 * apps/desktop/runtime-inputs.json for the real pins, or
 * component-manifest.test.mjs for a binary-free self-test.
 */
export async function buildManifest(components) {
  const manifest = []
  for (const component of components) {
    const { name, version, license, artifact } = component
    if (!name || !version || !license || !artifact)
      throw new Error(
        `Component descriptor missing name/version/license/artifact: ${JSON.stringify(component)}`
      )
    const bytes = await readFile(artifact)
    manifest.push({
      component: name,
      version,
      license,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }
  return manifest.sort((a, b) => a.component.localeCompare(b.component))
}

export function diffManifest(actual, expected) {
  const byName = (list) =>
    new Map(list.map((entry) => [entry.component, entry]))
  const actualByName = byName(actual)
  const expectedByName = byName(expected)
  const problems = []
  for (const [name, expectedEntry] of expectedByName) {
    const actualEntry = actualByName.get(name)
    if (!actualEntry) {
      problems.push(`Missing component in actual manifest: ${name}`)
      continue
    }
    for (const field of ['version', 'license', 'sha256']) {
      if (actualEntry[field] !== expectedEntry[field])
        problems.push(
          `${name}.${field} mismatch: expected ${expectedEntry[field]}, got ${actualEntry[field]}`
        )
    }
  }
  for (const name of actualByName.keys())
    if (!expectedByName.has(name))
      problems.push(`Unexpected component in actual manifest: ${name}`)
  return problems
}

async function main() {
  const [componentsPath, expectedManifestPath, outPath] = process.argv.slice(2)
  if (!componentsPath || !expectedManifestPath)
    throw new Error(
      'Usage: component-manifest.mjs <components.json> <expected-manifest.json> [out-manifest.json]'
    )
  const components = JSON.parse(await readFile(componentsPath, 'utf8'))
  const expected = JSON.parse(await readFile(expectedManifestPath, 'utf8'))
  const actual = await buildManifest(components)
  if (outPath) await writeFile(outPath, JSON.stringify(actual, null, 2))
  const problems = diffManifest(actual, expected)
  if (problems.length) {
    console.error(JSON.stringify({ passed: false, problems }, null, 2))
    process.exitCode = 1
    return
  }
  console.log(
    JSON.stringify({ passed: true, components: actual.length }, null, 2)
  )
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
