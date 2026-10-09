import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const builder = fileURLToPath(new URL('./build-deb.mjs', import.meta.url))
const configuration = JSON.parse(
  await readFile(new URL('./updates.json', import.meta.url), 'utf8')
)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function withBuilder(failChmod, check) {
  const home = await mkdtemp(join(tmpdir(), 'debian payload test '))
  try {
    const bundle = join(home, 'bundle with spaces')
    const output = join(home, 'output with spaces')
    const bin = join(home, 'inert tools')
    const record = join(home, 'package invocation.json')
    await mkdir(join(bundle, 'nested with spaces'), { recursive: true })
    await mkdir(bin)
    const entries = [
      ['updates.json', JSON.stringify(configuration), 0o664],
      ['nested with spaces/plain file', 'plain payload', 0o664],
      ['nested with spaces/launch file', '#!/bin/sh\nexit 0\n', 0o775],
      ['nested with spaces/world writable', 'payload', 0o666],
      ['nested with spaces/read only', 'readable payload', 0o440]
    ]
    for (const [path, contents, mode] of entries) {
      await writeFile(join(bundle, path), contents)
      await chmod(join(bundle, path), mode)
    }
    await chmod(join(bundle, 'nested with spaces'), 0o777)
    const files = entries.map(([path, contents]) => ({
      path,
      bytes: Buffer.byteLength(contents),
      sha256: digest(contents)
    }))
    await writeFile(
      join(bundle, 'package-inventory.json'),
      JSON.stringify({
        platform: 'linux-x64',
        kind: 'private-synthetic-preview',
        files,
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
      })
    )
    // Execute the actual builder's shell command with real chmod. These two
    // inert tools replace the container and package creation, not normalization.
    await writeFile(
      join(bin, 'docker'),
      `#!${process.execPath}
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { join, basename } = require('node:path')
const args = process.argv.slice(2)
assert.deepEqual(args.slice(0, 5), ['run', '--rm', '--network', 'none', '-v'])
assert.equal(args.length, 12)
assert.equal(args[5], process.env.PACKAGE_TEST_OUTPUT + ':/output')
assert.equal(args[6], 'ubuntu@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02')
assert.deepEqual(args.slice(7, 9), ['sh', '-c'])
assert.equal(args[10], 'package-builder')
assert.equal(args[11], '/output/tacticus-analytics-preview_' + process.env.PACKAGE_TEST_VERSION + '_amd64.deb')
const command = args[9].replaceAll('/output/payload', '"$PACKAGE_TEST_OUTPUT/payload"')
const result = spawnSync('/bin/sh', ['-c', command, args[10], join(process.env.PACKAGE_TEST_OUTPUT, basename(args[11]))], { env: process.env, stdio: 'inherit' })
process.exit(result.status ?? 1)
`
    )
    await writeFile(
      join(bin, 'dpkg-deb'),
      `#!${process.execPath}
require('node:fs').writeFileSync(process.env.PACKAGE_TEST_RECORD, JSON.stringify(process.argv.slice(2)))
`
    )
    for (const name of ['docker', 'dpkg-deb'])
      await chmod(join(bin, name), 0o755)
    if (failChmod) {
      await writeFile(join(bin, 'chmod'), '#!/bin/sh\nexit 73\n')
      await chmod(join(bin, 'chmod'), 0o755)
    }
    const result = spawnSync(process.execPath, [builder, bundle, output], {
      env: {
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: home,
        LANG: 'C',
        PACKAGE_TEST_OUTPUT: output,
        PACKAGE_TEST_VERSION: configuration.version,
        PACKAGE_TEST_RECORD: record
      },
      encoding: 'utf8',
      timeout: 10000
    })
    await check({ result, output, record, entries, files })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test(
  'Debian payload normalization clears shared writes and preserves read, traverse and executable files',
  { skip: process.platform === 'win32' },
  async () => {
    await withBuilder(
      false,
      async ({ result, output, record, entries, files }) => {
        assert.equal(result.status, 0, result.stderr)
        assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), [
          '--root-owner-group',
          '-Zgzip',
          '--build',
          join(output, 'payload'),
          join(
            output,
            `tacticus-analytics-preview_${configuration.version}_amd64.deb`
          )
        ])
        const payload = join(output, 'payload/opt/tacticus-analytics-preview')
        for (const [path, contents, mode] of entries) {
          assert.equal(
            (await stat(join(payload, path))).mode & 0o777,
            (mode | 0o444) & ~0o022,
            path
          )
          if (path !== 'updates.json')
            assert.equal(await readFile(join(payload, path), 'utf8'), contents)
        }
        for (const path of [
          'payload',
          'payload/DEBIAN',
          'payload/usr/share/applications',
          'payload/opt/tacticus-analytics-preview/nested with spaces'
        ]) {
          const mode = (await stat(join(output, path))).mode & 0o777
          assert.equal(mode & 0o555, 0o555, path)
          assert.equal(mode & 0o022, 0, path)
        }
        const updates = await readFile(join(payload, 'updates.json'))
        assert.deepEqual(JSON.parse(updates), {
          ...configuration,
          packageFormat: 'deb'
        })
        const inventory = JSON.parse(
          await readFile(join(payload, 'package-inventory.json'), 'utf8')
        )
        assert.deepEqual(inventory.files.slice(1), files.slice(1))
        assert.deepEqual(inventory.files[0], {
          path: 'updates.json',
          bytes: updates.length,
          sha256: digest(updates)
        })
        assert.equal(
          inventory.totalBytes,
          inventory.files.reduce((sum, file) => sum + file.bytes, 0)
        )
        assert.match(
          await readFile(join(output, 'payload/DEBIAN/control'), 'utf8'),
          new RegExp(
            `^Package: tacticus-analytics-preview\\nVersion: ${configuration.version.replaceAll('.', '\\.')}\\nArchitecture: amd64\\n`
          )
        )
        assert.match(
          await readFile(
            join(
              output,
              'payload/usr/share/applications/tacticus-analytics-preview.desktop'
            ),
            'utf8'
          ),
          /^\[Desktop Entry\]\nType=Application\n/
        )
      }
    )
  }
)

test(
  'a failed payload normalization refuses before the package builder runs',
  { skip: process.platform === 'win32' },
  async () => {
    await withBuilder(true, async ({ result, record }) => {
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Debian package builder failed/)
      await assert.rejects(stat(record), { code: 'ENOENT' })
    })
  }
)
