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
import { selectedWorkspace } from '../launcher/workspace-selection.mjs'

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
        encryptedTransfer: () => assert.fail('cancelled transfer ran')
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
    ['backup', 'failed', 'passphrase-mismatch', 'Return to workspace']
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
    assert.equal(dialog.type, status === 'passed' ? 'info' : 'error')
    if (reason === 'passphrase-mismatch')
      assert.match(dialog.detail, /did not match/)
    if (status === 'failed') assert.match(dialog.message, /preserved/)
  }
})
