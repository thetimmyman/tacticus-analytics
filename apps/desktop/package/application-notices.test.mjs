import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stageApplicationNotices } from './application-notices.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-notices-'))
  const application = join(root, 'application')
  const sourceModules = join(root, 'source')
  await mkdir(join(application, 'node_modules'), { recursive: true })
  await mkdir(sourceModules)
  const packageAt = async (base, path, version, files = {}) => {
    const directory = join(base, path)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'synthetic-package', version, license: 'MIT' })
    )
    for (const [name, bytes] of Object.entries(files)) {
      await mkdir(join(directory, name, '..'), { recursive: true })
      await writeFile(join(directory, name), bytes)
    }
    return directory
  }
  try {
    await run({ root, application, sourceModules, packageAt })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('preserves exact-version source notices and compiled legal text', async () => {
  await fixture(async ({ application, sourceModules, packageAt }) => {
    await packageAt(
      join(application, 'node_modules'),
      'synthetic-package',
      '2.0.0',
      { 'compiled/module.LEGAL.txt': 'Compiled synthetic notice' }
    )
    await packageAt(sourceModules, 'synthetic-package', '2.0.0', {
      LICENSE: 'Exact source synthetic license',
      NOTICE: 'Synthetic attribution'
    })
    const result = await stageApplicationNotices({ application, sourceModules })
    assert.equal(result.packagesRequiringReview, 0)
    assert.equal(result.packages[0].notices.length, 3)
    assert.equal(result.packages[0].sourceMatched, true)
    assert.equal(
      await readFile(
        join(application, 'third-party-notices/synthetic-package/LICENSE'),
        'utf8'
      ),
      'Exact source synthetic license'
    )
  })
})
test('never substitutes a same-name license from a different version', async () => {
  await fixture(async ({ application, sourceModules, packageAt }) => {
    await packageAt(
      join(application, 'node_modules'),
      'synthetic-package',
      '1.0.0'
    )
    await packageAt(sourceModules, 'synthetic-package', '2.0.0', {
      LICENSE: 'Wrong version synthetic license'
    })
    const result = await stageApplicationNotices({ application, sourceModules })
    assert.equal(result.packagesRequiringReview, 1)
    assert.equal(result.packages[0].sourceMatched, false)
    assert.deepEqual(result.packages[0].notices, [])
  })
})
test('finds the exact nested package and ignores notice symlinks', async () => {
  await fixture(async ({ root, application, sourceModules, packageAt }) => {
    await packageAt(
      join(application, 'node_modules'),
      'synthetic-package',
      '1.0.0'
    )
    await packageAt(sourceModules, 'synthetic-package', '2.0.0', {
      LICENSE: 'Wrong version'
    })
    const exact = await packageAt(
      sourceModules,
      'parent/node_modules/synthetic-package',
      '1.0.0',
      { COPYRIGHT: 'Exact nested attribution' }
    )
    await writeFile(join(root, 'private-input'), 'Must not be copied')
    await symlink(join(root, 'private-input'), join(exact, 'LICENSE'))
    const result = await stageApplicationNotices({ application, sourceModules })
    assert.equal(result.packages[0].sourceMatched, true)
    assert.equal(result.packages[0].notices.length, 1)
    assert.equal(
      await readFile(
        join(application, result.packages[0].notices[0].path),
        'utf8'
      ),
      'Exact nested attribution'
    )
  })
})
test('versionless vendored notices require the same pinned containing release', async () => {
  await fixture(async ({ application, sourceModules, packageAt }) => {
    await packageAt(join(application, 'node_modules'), 'container', '3.0.0')
    await packageAt(sourceModules, 'container', '4.0.0')
    const traced = await packageAt(
      join(application, 'node_modules'),
      'container/compiled/vendor',
      undefined
    )
    await packageAt(sourceModules, 'container/compiled/vendor', undefined, {
      LICENSE: 'Pinned vendored notice'
    })
    const mismatched = await stageApplicationNotices({
      application,
      sourceModules
    })
    assert.equal(
      mismatched.packages.find((entry) => entry.packagePath.endsWith('/vendor'))
        .sourceMatched,
      false
    )
    await packageAt(sourceModules, 'container', '3.0.0')
    const matched = await stageApplicationNotices({
      application,
      sourceModules
    })
    const vendor = matched.packages.find((entry) =>
      entry.packagePath.endsWith('/vendor')
    )
    assert.equal(vendor.sourceMatched, true)
    assert.equal(vendor.containingPackage.version, '3.0.0')
    assert.equal(vendor.notices.length, 1)
    assert.equal(
      (await readFile(join(traced, 'package.json'), 'utf8')).includes(
        'version'
      ),
      false
    )
  })
})
