import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const noticeName = (name) =>
  /^(?:LICEN[SC]E|NOTICE|COPYRIGHT|COPYING|AUTHORS)(?:[._-].*)?$/i.test(name) ||
  /\.LEGAL\.txt$/i.test(name)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function directories(root, visit) {
  const entries = await readdir(root, { withFileTypes: true })
  await visit(root, entries)
  for (const entry of entries)
    if (entry.isDirectory()) await directories(join(root, entry.name), visit)
}
async function manifest(directory) {
  try {
    if (!(await lstat(directory)).isDirectory()) return undefined
    const path = join(directory, 'package.json')
    if (!(await lstat(path)).isFile()) return undefined
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
const samePackage = (a, b) =>
  typeof a?.name === 'string' &&
  typeof a?.version === 'string' &&
  a.name === b?.name &&
  a.version === b?.version
async function container(directory, modules) {
  for (let path = dirname(directory); path !== modules; path = dirname(path)) {
    if (!relative(modules, path) || relative(modules, path).startsWith('..'))
      return undefined
    const info = await manifest(path)
    if (typeof info?.name === 'string' && typeof info?.version === 'string')
      return { directory: path, info }
  }
}

/** Preserve notices from the exact installed package, never a same-name version. */
export async function stageApplicationNotices({ application, sourceModules }) {
  const modules = join(application, 'node_modules')
  const packages = []
  await directories(modules, async (directory) => {
    const info = await manifest(directory)
    if (info) packages.push({ directory, info })
  })
  let sourceIndex
  const sources = async () => {
    if (!sourceIndex) {
      sourceIndex = []
      await directories(sourceModules, async (directory) => {
        const info = await manifest(directory)
        if (info) sourceIndex.push({ directory, info })
      })
    }
    return sourceIndex
  }
  const results = []
  for (const { directory, info } of packages) {
    const packagePath = relative(modules, directory)
    const direct = join(sourceModules, packagePath)
    let source
    let containingPackage
    const directInfo = await manifest(direct)
    if (samePackage(info, directInfo)) source = direct
    else if (
      !info.version &&
      !directInfo?.version &&
      JSON.stringify(info) === JSON.stringify(directInfo)
    ) {
      const tracedContainer = await container(directory, modules)
      const sourceContainer = await container(direct, sourceModules)
      if (
        samePackage(tracedContainer?.info, sourceContainer?.info) &&
        relative(tracedContainer.directory, directory) ===
          relative(sourceContainer.directory, direct)
      ) {
        source = direct
        containingPackage = {
          name: tracedContainer.info.name,
          version: tracedContainer.info.version,
          packagePath: relative(modules, tracedContainer.directory)
        }
      }
    }
    if (!source)
      source = (await sources()).find((entry) =>
        samePackage(info, entry.info)
      )?.directory
    const notices = []
    const preserved = new Set()
    for (const [root, origin] of [
      [directory, 'traced-package'],
      ...(source ? [[source, 'installed-source-package']] : [])
    ]) {
      async function collect(path) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const absolute = join(path, entry.name)
          if (entry.isDirectory() && entry.name !== 'node_modules')
            await collect(absolute)
          else if (entry.isFile() && noticeName(entry.name)) {
            const noticePath = relative(root, absolute)
            if (preserved.has(noticePath)) continue
            const bytes = await readFile(absolute)
            if (!bytes.length) continue
            const destination = join(
              'third-party-notices',
              packagePath,
              noticePath
            )
            await mkdir(join(application, destination, '..'), {
              recursive: true
            })
            await writeFile(join(application, destination), bytes, {
              mode: 0o600
            })
            preserved.add(noticePath)
            notices.push({ path: destination, origin, sha256: hash(bytes) })
          }
        }
      }
      await collect(root)
    }
    results.push({
      packagePath,
      name: info.name ?? null,
      version: info.version ?? null,
      declaredLicense: info.license ?? null,
      sourceMatched: Boolean(source),
      containingPackage: containingPackage ?? null,
      notices,
      status: notices.length ? 'notices-preserved' : 'review-required'
    })
  }
  const inventory = {
    scope:
      'Traced application package notices; not a redistribution approval or complete native dependency audit',
    packages: results,
    packagesRequiringReview: results.filter(
      (entry) => entry.status === 'review-required'
    ).length
  }
  await writeFile(
    join(application, 'application-notices.json'),
    JSON.stringify(inventory, null, 2),
    { mode: 0o600 }
  )
  return inventory
}
