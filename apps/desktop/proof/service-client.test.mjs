import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeServices } from './native-services.mjs'

test('unknown and legacy locks remain intact without PID-based recovery', async () => {
  const state = await mkdtemp(join(tmpdir(), 'desktop-owner-lock-'))
  try {
    await writeFile(join(state, 'canonical-objects.sql'), '')
    await writeFile(join(state, 'authority.sql'), '')
    for (const content of [String(process.pid), '2147483647', 'invalid lock']) {
      await writeFile(join(state, 'running.lock'), content, { mode: 0o600 })
      await assert.rejects(nativeServices({ state, schemaDirectory: state }), {
        code: 'EEXIST'
      })
      assert.equal(await readFile(join(state, 'running.lock'), 'utf8'), content)
    }
  } finally {
    await rm(state, { recursive: true, force: true })
  }
})

test('failed owner initialization releases only its acquired lock', async () => {
  const state = await mkdtemp(join(tmpdir(), 'desktop-owner-startup-'))
  try {
    await writeFile(join(state, 'canonical-objects.sql'), '')
    await writeFile(join(state, 'authority.sql'), '')
    await assert.rejects(
      nativeServices({ state, schemaDirectory: state, binaries: {} }),
      /Local service startup failed/
    )
    await assert.rejects(readFile(join(state, 'running.lock')), {
      code: 'ENOENT'
    })
  } finally {
    await rm(state, { recursive: true, force: true })
  }
})

test('cancelled startup never creates a workspace or starts an owner', async () => {
  const state = await mkdtemp(join(tmpdir(), 'desktop-aborted-startup-'))
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      nativeServices(
        { state: join(state, 'workspace') },
        { signal: controller.signal }
      ),
      { name: 'AbortError' }
    )
    await assert.rejects(readFile(join(state, 'workspace/running.lock')), {
      code: 'ENOENT'
    })
  } finally {
    await rm(state, { recursive: true, force: true })
  }
})

test(
  'an explicit service Node is used with and without the runtime guard',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop selected node '))
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
    try {
      const marker = join(root, 'selected-runtime-used')
      const executable = join(root, 'selected node')
      const guard = join(root, 'synthetic guard')
      await writeFile(
        executable,
        `#!/bin/sh\nprintf selected > ${quote(marker)}\nexec ${quote(process.execPath)} "$@"\n`,
        { mode: 0o700 }
      )
      // Only argument forwarding is exercised here. This fixture is not a kernel
      // lease or parent-death-signal qualification of the native runtime guard.
      await writeFile(guard, '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o700 })
      for (const runtimeGuard of [undefined, guard]) {
        await rm(marker, { force: true })
        const state = join(root, runtimeGuard ? 'guarded' : 'direct')
        await assert.rejects(
          nativeServices(
            { state, schemaDirectory: root, binaries: {}, runtimeGuard },
            { nodeExecutable: executable }
          )
        )
        assert.equal(await readFile(marker, 'utf8'), 'selected')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)

test('missing or relative service Node never falls back to the caller runtime', async () => {
  const state = await mkdtemp(join(tmpdir(), 'desktop missing selected node '))
  try {
    const config = { state, schemaDirectory: state, binaries: {} }
    await assert.rejects(
      nativeServices(config, { nodeExecutable: join(state, 'missing-node') }),
      { code: 'ENOENT' }
    )
    await assert.rejects(
      nativeServices(config, { nodeExecutable: 'node' }),
      /Absolute service Node executable required/
    )
    await assert.rejects(readFile(join(state, 'running.lock')), {
      code: 'ENOENT'
    })
  } finally {
    await rm(state, { recursive: true, force: true })
  }
})
