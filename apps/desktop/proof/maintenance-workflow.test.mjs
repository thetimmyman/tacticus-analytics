import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import {
  runWorkspaceMaintenance,
  workspaceSessions
} from '../launcher/maintenance-workflow.mjs'
import {
  selectedWorkspace,
  selectWorkspace
} from '../launcher/workspace-selection.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-maintenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'original')
  await mkdir(state, { mode: 0o700 })
  await writeFile(join(state, 'retained-data'), 'original', { mode: 0o600 })
  return { root, state, defaultState: state }
}

test('cancelling either encrypted operation returns to the original workspace without creating a destination', async (t) => {
  const f = await fixture(t)
  for (const operation of ['backup', 'restore']) {
    const directory = join(f.root, `${operation}-destination`)
    const outcome = await runWorkspaceMaintenance(
      { operation, encrypted: true, directory, source: join(f.root, 'saved') },
      {
        ...f,
        passphrase: async () => {
          throw Object.assign(new Error('cancelled'), { code: 'ECANCEL' })
        },
        encryptedTransfer: () => assert.fail('cancelled transfer ran'),
        progress: () => assert.fail('cancelled operation opened progress')
      }
    )
    assert.deepEqual(outcome, {
      status: 'cancelled',
      operation,
      state: f.state
    })
    assert.deepEqual(await readdir(f.root), ['original'])
    assert.equal(await selectedWorkspace(f.defaultState), f.state)
  }
})

test('a failed encrypted restore clears the secret and preserves the selected workspace and its data', async (t) => {
  const f = await fixture(t)
  const secret = Buffer.from('synthetic backup passphrase')
  const outcome = await runWorkspaceMaintenance(
    {
      operation: 'restore',
      encrypted: true,
      directory: join(f.root, 'restored'),
      source: join(f.root, 'saved')
    },
    {
      ...f,
      passphrase: async () => secret,
      encryptedTransfer: async () => {
        throw new Error('synthetic backup passphrase in unsafe upstream error')
      },
      services: () => assert.fail('failed restore was opened')
    }
  )
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.state, f.state)
  assert.equal(
    JSON.stringify(outcome).includes('synthetic backup passphrase'),
    false
  )
  assert.equal(
    secret.every((value) => value === 0),
    true
  )
  assert.equal(await selectedWorkspace(f.defaultState), f.state)
  assert.equal(
    await readFile(join(f.state, 'retained-data'), 'utf8'),
    'original'
  )
})

test('restore activates the new workspace only after native reopen and shutdown succeed', async (t) => {
  const f = await fixture(t)
  const directory = join(f.root, 'restored')
  const secret = Buffer.from('synthetic backup passphrase')
  const calls = []
  const outcome = await runWorkspaceMaintenance(
    {
      operation: 'restore',
      encrypted: true,
      directory,
      source: join(f.root, 'saved')
    },
    {
      ...f,
      passphrase: async () => secret,
      encryptedTransfer: async (
        _root,
        operation,
        destination,
        source,
        value
      ) => {
        assert.equal(operation, 'restore')
        assert.equal(destination, directory)
        assert.equal(source, join(f.root, 'saved'))
        assert.equal(value, secret)
        calls.push('transfer')
      },
      services: async () => {
        assert.equal(await selectedWorkspace(f.defaultState), f.state)
        calls.push('reopen')
        return {
          stop: async () => {
            assert.equal(await selectedWorkspace(f.defaultState), f.state)
            calls.push('stop')
          }
        }
      }
    }
  )
  assert.deepEqual(calls, ['transfer', 'reopen', 'stop'])
  assert.equal(outcome.status, 'passed')
  assert.equal(outcome.state, directory)
  assert.equal(await selectedWorkspace(f.defaultState), directory)
  assert.equal(
    secret.every((value) => value === 0),
    true
  )
  assert.equal(
    await readFile(join(f.state, 'retained-data'), 'utf8'),
    'original'
  )
})

test('failed native restore health or shutdown never changes the durable selection', async (t) => {
  const f = await fixture(t)
  for (const failure of ['reopen', 'stop']) {
    const directory = join(f.root, failure)
    const outcome = await runWorkspaceMaintenance(
      {
        operation: 'restore',
        encrypted: true,
        directory,
        source: join(f.root, 'saved')
      },
      {
        ...f,
        passphrase: async () => Buffer.from('synthetic backup passphrase'),
        encryptedTransfer: async () => {},
        services: async () => {
          if (failure === 'reopen') throw new Error('unsafe native detail')
          return {
            stop: async () => {
              throw new Error('unsafe native detail')
            }
          }
        }
      }
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(outcome.state, f.state)
    assert.equal(
      JSON.stringify(outcome).includes('unsafe native detail'),
      false
    )
    assert.equal(await selectedWorkspace(f.defaultState), f.state)
  }
})

test('successful backup keeps the current workspace and clears the passphrase', async (t) => {
  const f = await fixture(t)
  const secret = Buffer.from('synthetic backup passphrase')
  const directory = join(f.root, 'saved.tabackup')
  const outcome = await runWorkspaceMaintenance(
    { operation: 'backup', encrypted: true, directory },
    {
      ...f,
      passphrase: async () => secret,
      encryptedTransfer: async (_root, operation, state, other, value) => {
        assert.equal(operation, 'backup')
        assert.equal(state, f.state)
        assert.equal(other, directory)
        assert.equal(value, secret)
      },
      services: () => assert.fail('backup must not select or reopen a restore')
    }
  )
  assert.equal(outcome.status, 'passed')
  assert.equal(outcome.state, f.state)
  assert.equal(
    secret.every((value) => value === 0),
    true
  )
  assert.equal(await selectedWorkspace(f.defaultState), f.state)
})

for (const published of [false, true])
  test(`selection error ${published ? 'after' : 'before'} publication reopens only the copy confirmed by readback with a storage warning`, async (t) => {
    const f = await fixture(t)
    const directory = join(f.root, 'restored')
    const secret = Buffer.from('synthetic backup passphrase')
    const calls = []
    const outcome = await runWorkspaceMaintenance(
      {
        operation: 'restore',
        encrypted: true,
        directory,
        source: join(f.root, 'saved')
      },
      {
        ...f,
        passphrase: async () => secret,
        encryptedTransfer: async () => {
          await writeFile(join(directory, 'restored-data'), 'restored')
          calls.push('transfer')
        },
        services: async () => {
          assert.equal(
            await readFile(join(directory, 'restored-data'), 'utf8'),
            'restored'
          )
          calls.push('checked')
          return { stop: async () => calls.push('stopped') }
        },
        select: async (...args) => {
          calls.push('select')
          if (published) await selectWorkspace(...args)
          throw Object.assign(new Error('unsafe selector detail'), {
            code: 'EIO'
          })
        },
        readSelection: async (defaultState) => {
          calls.push('readback')
          return selectedWorkspace(defaultState)
        }
      }
    )
    const actual = await selectedWorkspace(f.defaultState)
    assert.equal(actual, published ? directory : f.state)
    assert.equal(outcome.state, actual)
    assert.equal(outcome.status, 'selection-warning')
    assert.equal(
      outcome.reason,
      published ? 'selection-restored' : 'selection-current'
    )
    assert.deepEqual(calls, [
      'transfer',
      'checked',
      'stopped',
      'select',
      'readback'
    ])
    assert.equal(
      JSON.stringify(outcome).includes('unsafe selector detail'),
      false
    )
    assert(secret.every((byte) => byte === 0))
    assert.equal(
      await readFile(join(f.state, 'retained-data'), 'utf8'),
      'original'
    )
    assert.equal(
      await readFile(join(directory, 'restored-data'), 'utf8'),
      'restored'
    )
    const opened = [],
      notices = []
    await workspaceSessions(f.state, {
      open: async (state) => {
        opened.push(state)
        return opened.length === 1 ? { operation: 'restore' } : undefined
      },
      maintain: async () => outcome,
      notify: async (value) => notices.push(value)
    })
    assert.deepEqual(opened, [f.state, actual])
    assert.deepEqual(notices, [outcome])
  })

for (const failure of ['readback', 'unrelated'])
  test(`${failure} selection stops reopening while retaining both copies and actual pointer effects`, async (t) => {
    const f = await fixture(t)
    const directory = join(f.root, 'restored')
    const other = join(f.root, 'other')
    await mkdir(other, { mode: 0o700 })
    if (failure === 'unrelated') await selectWorkspace(f.defaultState, other)
    const secret = Buffer.from('synthetic backup passphrase')
    const outcome = await runWorkspaceMaintenance(
      {
        operation: 'restore',
        encrypted: true,
        directory,
        source: join(f.root, 'saved')
      },
      {
        ...f,
        passphrase: async () => secret,
        encryptedTransfer: async () =>
          writeFile(join(directory, 'restored-data'), 'restored'),
        services: async () => ({ stop: async () => {} }),
        select: async (...args) => {
          if (failure === 'readback') await selectWorkspace(...args)
          throw Object.assign(new Error('unsafe selector detail'), {
            code: 'EIO'
          })
        },
        readSelection: async (defaultState) => {
          const actual = await selectedWorkspace(defaultState)
          if (failure === 'readback')
            throw Object.assign(new Error('unsafe readback detail'), {
              code: 'EIO'
            })
          return actual
        }
      }
    )
    assert.equal(
      await selectedWorkspace(f.defaultState),
      failure === 'readback' ? directory : other
    )
    assert.equal(outcome.status, 'selection-uncertain')
    assert.equal(outcome.reason, 'selection-unconfirmed')
    assert.equal(Object.hasOwn(outcome, 'state'), false)
    assert.equal(JSON.stringify(outcome).includes('unsafe'), false)
    assert(secret.every((byte) => byte === 0))
    assert.equal(
      await readFile(join(f.state, 'retained-data'), 'utf8'),
      'original'
    )
    assert.equal(
      await readFile(join(directory, 'restored-data'), 'utf8'),
      'restored'
    )
    let opened = 0,
      notified = 0
    const result = await workspaceSessions(f.state, {
      open: async () => {
        opened++
        assert.equal(opened, 1, 'An unconfirmed workspace must not reopen')
        return { operation: 'restore' }
      },
      maintain: async () => outcome,
      notify: async (value) => {
        assert.equal(value, outcome)
        notified++
      }
    })
    assert.equal(opened, 1)
    assert.equal(notified, 1)
    assert.equal(result, outcome)
  })

test('maintenance progress spans transfer and restored health checks and closes before the next window', async (t) => {
  for (const fails of [false, true]) {
    const f = await fixture(t)
    let visible = false
    const secret = Buffer.from('synthetic backup passphrase')
    const outcome = await runWorkspaceMaintenance(
      {
        operation: 'restore',
        encrypted: true,
        directory: join(f.root, 'restored'),
        source: join(f.root, 'saved')
      },
      {
        ...f,
        passphrase: async () => {
          assert.equal(visible, false)
          return secret
        },
        progress: async (operation) => {
          assert.equal(operation, 'restore')
          visible = true
          return async () => {
            assert.equal(visible, true)
            visible = false
          }
        },
        encryptedTransfer: async () => {
          assert.equal(visible, true)
          if (fails) throw new Error('Synthetic transfer failure')
        },
        services: async () => {
          assert.equal(visible, true)
          return { stop: async () => assert.equal(visible, true) }
        }
      }
    )
    assert.equal(outcome.status, fails ? 'failed' : 'passed')
    assert.equal(visible, false)
    assert(secret.every((byte) => byte === 0))
  }
})

test('an unavailable progress window refuses safely before transfer and clears the passphrase', async (t) => {
  const f = await fixture(t)
  const secret = Buffer.from('synthetic backup passphrase')
  const outcome = await runWorkspaceMaintenance(
    { operation: 'backup', encrypted: true, directory: join(f.root, 'saved') },
    {
      ...f,
      passphrase: async () => secret,
      progress: async () => {
        throw Object.assign(new Error('Native progress unavailable'), {
          code: 'ENATIVEDIALOG'
        })
      },
      encryptedTransfer: () =>
        assert.fail('Transfer must not run without progress')
    }
  )
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.state, f.state)
  assert.equal(outcome.reason, 'dialog-unavailable')
  assert(secret.every((byte) => byte === 0))
})

test('maintenance sessions return after cancellation and failure, then open a successful restored copy', async () => {
  const outcomes = [
    { status: 'cancelled', state: '/original' },
    { status: 'failed', state: '/original' },
    { status: 'passed', state: '/restored' }
  ]
  const opened = [],
    notices = []
  let index = 0
  await workspaceSessions('/original', {
    open: async (state) => {
      opened.push(state)
      return index < outcomes.length ? { operation: 'restore' } : undefined
    },
    maintain: async () => outcomes[index++],
    notify: async (outcome) => notices.push(outcome.status)
  })
  assert.deepEqual(opened, ['/original', '/original', '/original', '/restored'])
  assert.deepEqual(notices, ['failed', 'passed'])
})

test('verification performs one session and surfaces failed maintenance instead of retrying indefinitely', async () => {
  let opened = 0
  await assert.rejects(
    workspaceSessions('/original', {
      verify: true,
      open: async () => {
        opened++
        return { operation: 'restore' }
      },
      maintain: async () => ({ status: 'failed', state: '/original' }),
      notify: async () =>
        assert.fail('verification displayed a consumer dialog')
    }),
    /Workspace maintenance verification failed/
  )
  assert.equal(opened, 1)
})

test('known passphrase problems produce safe actionable reasons without creating restore data', async (t) => {
  const f = await fixture(t)
  for (const [code, reason] of [
    ['EPASSPHRASELENGTH', 'passphrase-length'],
    ['EPASSPHRASEMISMATCH', 'passphrase-mismatch'],
    ['ENATIVEDIALOG', 'dialog-unavailable'],
    ['__proto__', 'transfer']
  ]) {
    const outcome = await runWorkspaceMaintenance(
      {
        operation: 'backup',
        encrypted: true,
        directory: join(f.root, 'saved')
      },
      {
        ...f,
        passphrase: async () => {
          throw Object.assign(new Error('unsafe secret detail'), { code })
        }
      }
    )
    assert.equal(outcome.reason, reason)
    assert.equal(
      JSON.stringify(outcome).includes('unsafe secret detail'),
      false
    )
    assert.deepEqual(await readdir(f.root), ['original'])
  }
})

test('the native result dialog offers return to the current workspace or opening the checked restored copy', async () => {
  const source = await readFile(
    new URL('../launcher/maintenance-result.cjs', import.meta.url),
    'utf8'
  )
  const require = createRequire(import.meta.url)
  for (const [operation, status, reason, expected] of [
    ['backup', 'passed', '', 'Return to workspace'],
    ['restore', 'passed', '', 'Open restored workspace'],
    ['restore', 'failed', '', 'Return to workspace'],
    ['backup', 'failed', 'passphrase-mismatch', 'Return to workspace'],
    [
      'restore',
      'selection-warning',
      'selection-restored',
      'Open restored workspace'
    ],
    [
      'restore',
      'selection-warning',
      'selection-current',
      'Return to workspace'
    ],
    ['restore', 'selection-uncertain', 'selection-unconfirmed', 'Close']
  ]) {
    let dialog
    await new Promise((resolve, reject) => {
      const electron = {
        app: {
          enableSandbox() {},
          setPath() {},
          whenReady: () => Promise.resolve(),
          quit: resolve,
          exit: reject
        },
        dialog: {
          showMessageBox: async (options) => {
            dialog = options
          }
        }
      }
      runInNewContext(source, {
        require: (name) => (name === 'electron' ? electron : require(name)),
        process: {
          argv: [
            'electron',
            'result',
            operation,
            status,
            '/synthetic/backup',
            reason
          ]
        }
      })
    })
    assert.deepEqual(Array.from(dialog.buttons), [expected])
    assert.equal(
      dialog.type,
      status.startsWith('selection-')
        ? 'warning'
        : status === 'passed'
          ? 'info'
          : 'error'
    )
    if (reason === 'passphrase-mismatch')
      assert.match(dialog.detail, /did not match/)
    if (status === 'failed') assert.match(dialog.message, /preserved/)
    if (status.startsWith('selection-')) {
      assert.match(dialog.message, /created and checked/)
      assert.match(dialog.detail, /storage error/)
      assert.match(dialog.detail, /Restored copy:\n\/synthetic\/backup/)
      assert.doesNotMatch(dialog.message, /could not be restored|was preserved/)
      if (status === 'selection-warning')
        assert.match(dialog.detail, /may not be retained after a restart/)
      else assert.match(dialog.detail, /close without opening a workspace/)
    }
  }
})
