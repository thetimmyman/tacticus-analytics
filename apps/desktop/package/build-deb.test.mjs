import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
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
const output = ${JSON.stringify(output)}
const version = ${JSON.stringify(configuration.version)}
assert.deepEqual(args.slice(0, 5), ['run', '--rm', '--network', 'none', '-v'])
assert.equal(args.length, 12)
assert.equal(args[5], output + ':/output')
assert.equal(args[6], 'ubuntu@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02')
assert.deepEqual(args.slice(7, 9), ['sh', '-c'])
assert.equal(args[10], 'package-builder')
assert.equal(args[11], '/output/tacticus-analytics-preview_' + version + '_amd64.deb')
const command = args[9].replaceAll('/output/payload', '"$2/payload"')
const result = spawnSync('/bin/sh', ['-c', command, args[10], join(output, basename(args[11])), output], { env: process.env, stdio: 'inherit' })
process.exit(result.status ?? 1)
`
    )
    await writeFile(
      join(bin, 'dpkg-deb'),
      `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)))
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
        LANG: 'C'
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

test(
  'Debian installation supplies an app-specific namespace profile and reversible package hooks',
  { skip: process.platform === 'win32' },
  async () => {
    await withBuilder(false, async ({ result, output }) => {
      assert.equal(result.status, 0, result.stderr)
      const profile = await readFile(
        join(
          output,
          'payload/usr/share/tacticus-analytics-preview/apparmor-profile'
        ),
        'utf8'
      )
      assert.match(
        profile,
        /profile tacticus-analytics-preview \/opt\/tacticus-analytics-preview\/electron\/electron/
      )
      assert.match(profile, /userns,/)
      for (const name of ['postinst', 'prerm', 'postrm']) {
        const path = join(output, 'payload/DEBIAN', name)
        const file = await open(path, 'r')
        try {
          assert.equal((await file.stat()).mode & 0o111, 0o111)
          const script = await file.readFile('utf8')
          assert.doesNotMatch(
            script,
            /sysctl -w|no-sandbox|chmod.*[467][0-7]{3}/
          )
        } finally {
          await file.close()
        }
      }
      const home = join(output, 'hook test')
      const etc = join(home, 'etc/apparmor.d')
      const share = join(home, 'usr/share/tacticus-analytics-preview')
      const feature = join(home, 'namespace-feature')
      const kernel = join(home, 'loaded-profiles')
      const tools = join(home, 'tools')
      const invocations = join(home, 'parser-calls')
      await mkdir(join(etc, 'abi'), { recursive: true })
      await writeFile(join(etc, 'abi/4.0'), 'Synthetic ABI marker')
      await mkdir(share, { recursive: true })
      await mkdir(tools)
      await writeFile(join(share, 'apparmor-profile'), profile)
      await writeFile(feature, '1\n')
      await writeFile(kernel, 'tacticus-analytics-preview (unconfined)\n')
      await writeFile(
        join(tools, 'apparmor_parser'),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PARSER_CALLS"\nexit "${PARSER_EXIT:-0}"\n',
        { mode: 0o755 }
      )
      const run = async (name, action, extra = {}) => {
        const source = await readFile(
          join(output, 'payload/DEBIAN', name),
          'utf8'
        )
        const quoted = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
        const script = source
          .replaceAll('/etc/apparmor.d', quoted(etc))
          .replaceAll('/usr/share/tacticus-analytics-preview', quoted(share))
          .replaceAll(
            '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
            quoted(feature)
          )
          .replaceAll('/sys/kernel/security/apparmor/profiles', quoted(kernel))
        return spawnSync('/bin/sh', ['-c', script, name, action], {
          env: {
            PATH: `${tools}:/usr/bin:/bin`,
            PARSER_CALLS: invocations,
            ...extra
          },
          encoding: 'utf8'
        })
      }
      assert.equal((await run('postinst', 'configure')).status, 0)
      assert.equal(
        await readFile(join(etc, 'tacticus-analytics-preview'), 'utf8'),
        profile
      )
      assert.match(await readFile(invocations, 'utf8'), /-r/)
      assert.notEqual(
        (await run('postinst', 'configure', { PARSER_EXIT: '73' })).status,
        0
      )
      assert.equal((await run('prerm', 'upgrade')).status, 0)
      assert.equal(
        await readFile(join(etc, 'tacticus-analytics-preview'), 'utf8'),
        profile
      )
      assert.equal((await run('prerm', 'remove')).status, 0)
      assert.match(await readFile(invocations, 'utf8'), /-R/)
      await assert.rejects(stat(join(etc, 'tacticus-analytics-preview')), {
        code: 'ENOENT'
      })
      await rm(feature)
      assert.equal((await run('postinst', 'configure')).status, 0)
      await assert.rejects(stat(join(etc, 'tacticus-analytics-preview')), {
        code: 'ENOENT'
      })
      await writeFile(feature, '0\n')
      await rm(join(etc, 'abi/4.0'))
      assert.equal((await run('postinst', 'configure')).status, 0)
      await assert.rejects(stat(join(etc, 'tacticus-analytics-preview')), {
        code: 'ENOENT'
      })
      await writeFile(feature, '1\n')
      assert.notEqual((await run('postinst', 'configure')).status, 0)
      await writeFile(join(etc, 'abi/4.0'), 'Synthetic ABI marker')
      await writeFile(
        join(etc, 'tacticus-analytics-preview'),
        'Administrator policy'
      )
      assert.equal((await run('postinst', 'configure')).status, 0)
      assert.equal((await run('prerm', 'remove')).status, 0)
      assert.equal((await run('postrm', 'purge')).status, 0)
      assert.equal(
        await readFile(join(etc, 'tacticus-analytics-preview'), 'utf8'),
        'Administrator policy'
      )
    })
  }
)
