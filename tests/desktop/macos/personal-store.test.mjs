import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { projectCachedPlayer } from '../../../packages/workspace-onboarding/v1.mjs'
import { createPersonalStore } from '../../../apps/desktop/platform/macos/personal-store.mjs'

const oldHandle = '00000000-0000-4000-8000-000000000001'
const newHandle = '00000000-0000-4000-8000-000000000002'
const allow = () => {}
const primary = (directory) => join(directory, 'personal.json')
const files = (directory) => fs.readdirSync(directory).sort()
const json = (directory, name) =>
  JSON.parse(fs.readFileSync(join(directory, name), 'utf8'))
const privateWrite = (path, bytes) =>
  fs.writeFileSync(path, bytes, { mode: 0o600 })

function personal() {
  return projectCachedPlayer({
    player: {
      details: { name: 'Synthetic Historical Player', powerLevel: 10 },
      units: [],
      inventory: {
        items: [],
        upgrades: [],
        shards: [],
        mythicShards: [],
        xpBooks: [],
        abilityBadges: {},
        components: [],
        forgeBadges: [],
        orbs: {},
        resetStones: 1
      },
      progress: { campaigns: [], legendaryEvents: [] }
    },
    updatedOn: 1767225600
  })
}

function snapshot(handle = oldHandle) {
  return {
    version: 1,
    status: 'active',
    capabilities: { Player: 'verified-scope' },
    vaultReferences: { Player: handle },
    personal: personal()
  }
}

async function disposable(action) {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-personal-store-'))
  try {
    await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('empty owner state remains empty through authorized reconciliation and two restarts', async () => {
  await disposable((directory) => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const store = createPersonalStore(directory)
      assert.equal(store.mode(), 'ready')
      assert.deepEqual(store.read(), {})
      assert.deepEqual(store.cleanupReferences(), [])
      assert.equal(store.checkpointAvailable(), false)
      assert.equal(store.reconcile(allow), 'ready')
      assert.deepEqual(files(directory), [])
    }
  })
})

test('malformed and strictly invalid private snapshots enter holding without writing or extracting references', async () => {
  const invalid = [
    '{',
    '{"vaultReferences":{"Player":"' + oldHandle + '"},',
    JSON.stringify({ ...snapshot(), unexpected: true }),
    JSON.stringify({ ...snapshot(), version: 2 }),
    JSON.stringify({
      ...snapshot(),
      capabilities: { Unknown: 'verified-scope' }
    }),
    JSON.stringify({ ...snapshot(), capabilities: { Player: 'invented' } }),
    JSON.stringify({
      ...snapshot(),
      vaultReferences: { Player: 'not-a-uuid' }
    }),
    JSON.stringify({ ...snapshot(), guildId: '' }),
    JSON.stringify({
      ...snapshot(),
      raid: { season: 1, guildId: 'SYN001', syncedAt: -1 }
    }),
    JSON.stringify({
      ...snapshot(),
      personal: { ...personal(), displayName: 'Forged' }
    })
  ]
  for (const bytes of invalid) {
    await disposable((directory) => {
      privateWrite(primary(directory), bytes)
      const store = createPersonalStore(directory)
      assert.equal(store.mode(), 'recovery-required')
      assert.throws(
        () => store.read(),
        (error) => error.code === 'ERECOVERY'
      )
      assert.throws(
        () => store.write(snapshot(newHandle), allow),
        (error) => error.code === 'ERECOVERY'
      )
      assert.equal(store.cleanupReferences(), null)
      assert.equal(store.checkpointAvailable(), false)
      assert.deepEqual(files(directory), ['personal.json'])
      assert.equal(fs.readFileSync(primary(directory), 'utf8'), bytes)
    })
  }
})

test('unsafe private links, permissions, oversized files and nonblocking FIFO reads fail closed', async () => {
  for (const kind of ['symlink', 'hardlink', 'mode', 'oversize', 'fifo']) {
    await disposable((directory) => {
      const path = primary(directory)
      if (kind === 'symlink' || kind === 'hardlink') {
        const target = join(directory, 'target.json')
        privateWrite(target, '{}')
        if (kind === 'hardlink') fs.linkSync(target, path)
        else fs.symlinkSync(target, path)
      } else if (kind === 'fifo') {
        assert.equal(spawnSync('mkfifo', ['-m', '600', path]).status, 0)
      } else {
        privateWrite(
          path,
          kind === 'oversize' ? Buffer.alloc(4 * 1024 * 1024 + 1) : '{}'
        )
        if (kind === 'mode') fs.chmodSync(path, 0o640)
      }
      assert.throws(() => createPersonalStore(directory))
      assert.equal(
        files(directory).some((name) => name.includes('incident')),
        false
      )
    })
  }
})

test('constructor rejects malformed or unsafe metadata rather than silently losing retention', async () => {
  for (const name of ['personal-checkpoint.json', 'personal-journal.json']) {
    await disposable((directory) => {
      privateWrite(join(directory, name), '{')
      assert.throws(
        () => createPersonalStore(directory),
        (error) => error.code === 'EPRIVATESTATE'
      )
      assert.deepEqual(files(directory), [name])
    })
    await disposable((directory) => {
      fs.symlinkSync(primary(directory), join(directory, name))
      assert.throws(() => createPersonalStore(directory))
    })
  }
})

test('normal writes validate the actual projection and create only matching protected private records', async () => {
  await disposable((directory) => {
    const store = createPersonalStore(directory)
    assert.equal(store.write(snapshot(), allow), 'ready')
    assert.deepEqual(store.read(), snapshot())
    assert.deepEqual(store.cleanupReferences(), [oldHandle])
    assert.equal(store.checkpointAvailable(), true)
    assert.deepEqual(
      json(directory, 'personal-checkpoint.json').snapshot,
      snapshot()
    )
    assert.equal(json(directory, 'personal-journal.json').phase, 'resolved')
    for (const name of files(directory))
      assert.equal(fs.statSync(join(directory, name)).mode & 0o777, 0o600)
    assert.equal(Object.hasOwn(store.read(), 'retainedReferences'), false)
    assert.equal(Object.hasOwn(store.read(), 'unknownReferences'), false)
    const invalid = snapshot()
    invalid.personal.apiData.inventory.apiKey = 'SYNTHETIC-CREDENTIAL-CANARY'
    assert.throws(() => store.write(invalid, allow))
    assert.deepEqual(store.read(), snapshot())
    assert.equal(createPersonalStore(directory).mode(), 'ready')
  })
})

test('existing v1 opaque guild IDs and retained stale raid bindings remain readable offline', async () => {
  await disposable((directory) => {
    const retained = {
      ...snapshot(),
      guildId: 'Synthetic guild: ü',
      raid: {
        season: 1,
        guildId: 'Synthetic prior guild',
        syncedAt: 1767225600000
      },
      capabilities: {
        Player: 'verified-scope',
        Guild: 'verified-scope',
        'Guild Raid': 'guild-binding-unavailable'
      },
      vaultReferences: { Player: oldHandle, Guild: oldHandle }
    }
    const store = createPersonalStore(directory)
    store.write(retained, allow)
    assert.deepEqual(createPersonalStore(directory).read(), retained)
  })
})

test('valid existing cache cannot be restored; invalid candidate and initial expiry make no changes', async () => {
  await disposable((directory) => {
    const store = createPersonalStore(directory)
    store.write(snapshot(), allow)
    const before = files(directory).map((name) => [
      name,
      fs.readFileSync(join(directory, name), 'utf8')
    ])
    assert.throws(
      () => store.restorePersonal(personal(), allow),
      (error) => error.code === 'ERESTORE'
    )
    assert.throws(
      () => store.restoreCheckpoint(allow),
      (error) => error.code === 'ERESTORE'
    )
    assert.deepEqual(
      files(directory).map((name) => [
        name,
        fs.readFileSync(join(directory, name), 'utf8')
      ]),
      before
    )
  })
  await disposable((directory) => {
    privateWrite(primary(directory), '{"damaged":')
    const store = createPersonalStore(directory)
    let calls = 0
    const invalid = personal()
    invalid.resources.guildRaidTokens = { current: 100 }
    assert.throws(() => store.restorePersonal(invalid, () => calls++))
    assert.equal(calls, 0)
    assert.throws(
      () =>
        store.restorePersonal(personal(), () => {
          throw Object.assign(new Error('Synthetic expired owner'), {
            code: 'ESESSION'
          })
        }),
      (error) => error.code === 'ESESSION'
    )
    assert.deepEqual(files(directory), ['personal.json'])
    assert.equal(fs.readFileSync(primary(directory), 'utf8'), '{"damaged":')
  })
})

test('checkpoint restore preserves original bytes and private old handles, restores only historical data and survives restart', async () => {
  await disposable((directory) => {
    createPersonalStore(directory).write(snapshot(), allow)
    const damaged = Buffer.from([0x7b, 0x00, 0xff, 0x7d])
    privateWrite(primary(directory), damaged)
    const store = createPersonalStore(directory)
    assert.equal(store.checkpointAvailable(), true)
    assert.equal(store.restoreCheckpoint(allow), 'ready')
    const restored = store.read()
    assert.equal(restored.status, 'historical-offline')
    assert.deepEqual(restored.personal, personal())
    assert.deepEqual(restored.vaultReferences, {})
    assert.deepEqual(restored.capabilities, {
      Player: 'reconnect-required',
      Guild: 'reconnect-required',
      'Guild Raid': 'reconnect-required'
    })
    const incidents = files(directory).filter((name) =>
      name.startsWith('personal-incident.')
    )
    assert.equal(incidents.length, 1)
    assert.deepEqual(fs.readFileSync(join(directory, incidents[0])), damaged)
    const ledger = json(directory, 'personal-journal.json')
    assert.deepEqual(ledger.retainedReferences, [oldHandle])
    assert.equal(ledger.unknownReferences, true)
    assert.equal(store.cleanupReferences(), null)
    assert.equal(JSON.stringify(restored).includes(oldHandle), false)
    const reopened = createPersonalStore(directory)
    assert.equal(reopened.mode(), 'ready')
    assert.deepEqual(reopened.read(), restored)
    assert.equal(reopened.cleanupReferences(), null)
    reopened.write(snapshot(newHandle), allow)
    assert.equal(createPersonalStore(directory).cleanupReferences(), null)
    assert.deepEqual(
      json(directory, 'personal-journal.json').retainedReferences,
      [oldHandle]
    )
  })
})

test('known-prior missing cache requires recovery while a selected restore does not adopt live checkpoint privileges', async () => {
  await disposable((directory) => {
    createPersonalStore(directory).write(snapshot(), allow)
    fs.unlinkSync(primary(directory))
    const store = createPersonalStore(directory)
    assert.equal(store.mode(), 'recovery-required')
    assert.throws(
      () => store.read(),
      (error) => error.code === 'ERECOVERY'
    )
    assert.equal(store.restorePersonal(personal(), allow), 'ready')
    assert.deepEqual(store.read().vaultReferences, {})
    assert.equal(store.cleanupReferences(), null)
    assert.equal(
      files(directory).some((name) => name.startsWith('personal-incident.')),
      false
    )
  })
})

test('incident quota refuses without mutation or overwriting retained originals', async () => {
  await disposable((directory) => {
    privateWrite(primary(directory), '{')
    for (let index = 1; index <= 3; index++)
      privateWrite(
        join(
          directory,
          `personal-incident.00000000-0000-4000-8000-00000000000${index}.json`
        ),
        `Synthetic original ${index}`
      )
    const before = files(directory).map((name) => [
      name,
      fs.readFileSync(join(directory, name), 'utf8')
    ])
    assert.throws(
      () => createPersonalStore(directory).restorePersonal(personal(), allow),
      (error) => error.code === 'ELIMIT'
    )
    assert.deepEqual(
      files(directory).map((name) => [
        name,
        fs.readFileSync(join(directory, name), 'utf8')
      ]),
      before
    )
  })
})

test('stale generation and final owner expiry preserve the damaged primary', async () => {
  await disposable((directory) => {
    privateWrite(primary(directory), '{')
    const store = createPersonalStore(directory)
    privateWrite(primary(directory), JSON.stringify(snapshot()))
    assert.throws(
      () => store.restorePersonal(personal(), allow),
      (error) => error.code === 'ESTALE'
    )
    assert.deepEqual(json(directory, 'personal.json'), snapshot())
    assert.deepEqual(files(directory), ['personal.json'])
  })
  await disposable((directory) => {
    privateWrite(primary(directory), '{')
    const store = createPersonalStore(directory)
    let calls = 0
    assert.throws(
      () =>
        store.restorePersonal(personal(), () => {
          if (++calls === 3)
            throw Object.assign(new Error('Synthetic expiry'), {
              code: 'ESESSION'
            })
        }),
      (error) => error.code === 'ESESSION'
    )
    assert.equal(fs.readFileSync(primary(directory), 'utf8'), '{')
    assert.equal(store.mode(), 'recovery-required')
    assert.equal(store.cleanupReferences(), null)
    assert.equal(json(directory, 'personal-journal.json').phase, 'pending')
    const retained = files(directory).find((name) =>
      name.startsWith('personal-incident.')
    )
    assert.equal(fs.readFileSync(join(directory, retained), 'utf8'), '{')
  })
})

for (const failure of [
  'pending-journal-directory-fsync',
  'primary-before-rename',
  'primary-directory-fsync',
  'checkpoint-rename',
  'resolved-journal-rename',
  'resolved-journal-directory-fsync'
]) {
  test(`real disposable-file ${failure} interruption protects both handles until fresh authorized reconciliation`, async () => {
    await disposable((directory) => {
      const store = createPersonalStore(directory)
      store.write(snapshot(), allow)
      const originalRename = fs.renameSync,
        originalFsync = fs.fsyncSync
      let directorySyncs = 0,
        journalRenames = 0
      const interrupt = () => {
        throw Object.assign(new Error('Synthetic I/O interruption'), {
          code: 'EIO'
        })
      }
      fs.renameSync = (source, target) => {
        if (
          failure === 'primary-before-rename' &&
          target === primary(directory)
        )
          interrupt()
        if (
          failure === 'checkpoint-rename' &&
          target === join(directory, 'personal-checkpoint.json')
        )
          interrupt()
        if (
          failure === 'resolved-journal-rename' &&
          target === join(directory, 'personal-journal.json') &&
          ++journalRenames === 2
        )
          interrupt()
        return originalRename(source, target)
      }
      fs.fsyncSync = (descriptor) => {
        if (fs.fstatSync(descriptor).isDirectory()) {
          directorySyncs++
          if (
            (failure === 'pending-journal-directory-fsync' &&
              directorySyncs === 1) ||
            (failure === 'primary-directory-fsync' && directorySyncs === 2) ||
            (failure === 'resolved-journal-directory-fsync' &&
              directorySyncs === 4)
          )
            interrupt()
        }
        return originalFsync(descriptor)
      }
      syncBuiltinESMExports()
      try {
        if (
          ['primary-before-rename', 'pending-journal-directory-fsync'].includes(
            failure
          )
        )
          assert.throws(
            () => store.write(snapshot(newHandle), allow),
            (error) => error.code === 'EIO'
          )
        else
          assert.equal(
            store.write(snapshot(newHandle), allow),
            'commit-uncertain'
          )
      } finally {
        fs.renameSync = originalRename
        fs.fsyncSync = originalFsync
        syncBuiltinESMExports()
      }
      const visible = [
        'primary-before-rename',
        'pending-journal-directory-fsync'
      ].includes(failure)
        ? oldHandle
        : newHandle
      assert.equal(store.read().vaultReferences.Player, visible)
      assert.equal(
        json(directory, 'personal.json').vaultReferences.Player,
        visible
      )
      assert.equal(store.mode(), 'commit-uncertain')
      assert.equal(store.cleanupReferences(), null)
      const ledger = json(directory, 'personal-journal.json')
      assert.equal(
        ledger.phase,
        failure === 'resolved-journal-directory-fsync' ? 'resolved' : 'pending'
      )
      assert.deepEqual(ledger.protectedReferences, [oldHandle, newHandle])
      const reopened = createPersonalStore(directory)
      assert.equal(reopened.mode(), 'commit-uncertain')
      assert.equal(reopened.cleanupReferences(), null)
      assert.throws(
        () =>
          reopened.reconcile(() => {
            throw Object.assign(new Error('Synthetic expiry'), {
              code: 'ESESSION'
            })
          }),
        (error) => error.code === 'ESESSION'
      )
      assert.equal(reopened.mode(), 'commit-uncertain')
      assert.equal(reopened.reconcile(allow), 'ready')
      assert.equal(reopened.reconcile(allow), 'ready')
      assert.deepEqual(reopened.cleanupReferences(), [visible])
      assert.deepEqual(
        json(directory, 'personal-checkpoint.json').snapshot,
        reopened.read()
      )
      assert.equal(createPersonalStore(directory).mode(), 'ready')
    })
  })
}

test('post-restore checkpoint failure keeps historical replacement readable and unknown cleanup paused after repair', async () => {
  await disposable((directory) => {
    createPersonalStore(directory).write(snapshot(), allow)
    privateWrite(primary(directory), '{')
    const store = createPersonalStore(directory)
    const rename = fs.renameSync
    fs.renameSync = (source, target) => {
      if (target === join(directory, 'personal-checkpoint.json'))
        throw Object.assign(new Error('Synthetic checkpoint interruption'), {
          code: 'EIO'
        })
      return rename(source, target)
    }
    syncBuiltinESMExports()
    try {
      assert.equal(store.restoreCheckpoint(allow), 'commit-uncertain')
    } finally {
      fs.renameSync = rename
      syncBuiltinESMExports()
    }
    assert.equal(store.read().status, 'historical-offline')
    const reopened = createPersonalStore(directory)
    assert.equal(reopened.mode(), 'commit-uncertain')
    assert.equal(reopened.reconcile(allow), 'ready')
    assert.equal(reopened.cleanupReferences(), null)
    assert.deepEqual(
      json(directory, 'personal-journal.json').retainedReferences,
      [oldHandle]
    )
    assert.equal(
      files(directory).filter((name) => name.startsWith('personal-incident.'))
        .length,
      1
    )
    fs.unlinkSync(join(directory, 'personal-journal.json'))
    assert.equal(createPersonalStore(directory).cleanupReferences(), null)
  })
})
