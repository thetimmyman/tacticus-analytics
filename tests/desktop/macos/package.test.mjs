import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  inventory,
  stage
} from '../../../apps/desktop/platform/macos/stage.mjs'
import { privateState } from '../../../apps/desktop/platform/macos/state.mjs'

test('package inventory rejects mutable state and escaping symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac package '))
  try {
    const pkg = join(root, 'package')
    await mkdir(pkg)
    await writeFile(join(pkg, 'asset.txt'), 'synthetic')
    const original = await inventory(pkg)
    assert.equal(original.length, 1)
    await writeFile(join(pkg, '.env'), 'SYNTHETIC-CANARY')
    await assert.rejects(inventory(pkg), /Mutable or private/)
    await rm(join(pkg, '.env'))
    await writeFile(join(root, 'outside'), 'synthetic')
    await symlink('../outside', join(pkg, 'external'))
    await assert.rejects(inventory(pkg), /External package symlink/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('package cannot stage a guessed platform or missing source identity', async () => {
  await assert.rejects(
    stage({
      output: '/synthetic',
      architecture: 'universal',
      sourceCommit: 'a'.repeat(40)
    }),
    /Explicit source/
  )
  await assert.rejects(
    stage({ output: '/synthetic', architecture: 'arm64', sourceCommit: '' }),
    /Explicit source/
  )
})

test('private projected state survives a new reader; unsafe replacements refuse activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac state ü ')),
    path = join(root, 'personal.json')
  try {
    const state = privateState(path)
    state.write({
      version: 1,
      personal: { displayName: 'Example Player', roster: [] },
      vaultReferences: { Player: 'opaque-handle' }
    })
    assert.equal(
      privateState(path).read().personal.displayName,
      'Example Player'
    )
    await rm(path)
    await writeFile(join(root, 'unsafe'), '{}', { mode: 0o600 })
    await symlink('unsafe', path)
    assert.throws(() => privateState(path))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
