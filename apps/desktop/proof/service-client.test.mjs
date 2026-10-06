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
