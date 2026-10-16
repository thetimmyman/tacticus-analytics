import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { maintenanceProgress } from '../launcher/maintenance-progress.mjs'

test('progress uses a native view and closes its process on completion', async (t) => {
  for (const operation of ['backup', 'restore']) {
    let child
    const close = await maintenanceProgress(operation, {
      spawn: (executable, args, options) => {
        assert.equal(executable, '/usr/bin/zenity')
        assert(args.includes('--pulsate'))
        assert(args.includes('--no-cancel'))
        assert(args.includes('--auto-close'))
        child = spawn(
          process.execPath,
          [
            '-e',
            "process.stdin.resume(); process.stdin.on('end',()=>process.exit(0))"
          ],
          options
        )
        t.after(() => child.kill('SIGKILL'))
        return child
      }
    })
    assert.equal(child.exitCode, null)
    await close()
    await close()
    assert.equal(child.exitCode, 0)
  }
})

test('a dismissed progress view does not prevent cleanup or reopen', async (t) => {
  let child
  const close = await maintenanceProgress('restore', {
    spawn: (_executable, _args, options) => {
      child = spawn(process.execPath, ['-e', 'process.exit(0)'], options)
      t.after(() => child.kill('SIGKILL'))
      return child
    }
  })
  await once(child, 'close')
  await close()
  assert.equal(child.exitCode, 0)
})

test('a stuck progress process is terminated and cannot hold workspace reopening indefinitely', async (t) => {
  let child
  const close = await maintenanceProgress('backup', {
    spawn: (_executable, _args, options) => {
      child = spawn(
        process.execPath,
        [
          '-e',
          "process.stdin.resume(); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"
        ],
        options
      )
      t.after(() => child.kill('SIGKILL'))
      return child
    }
  })
  await close()
  assert.equal(child.signalCode, 'SIGKILL')
})

test('an unavailable native executable reports a safe dialog error', async () => {
  await assert.rejects(
    maintenanceProgress('backup', {
      spawn: (_executable, _args, options) =>
        spawn('/synthetic-missing-progress-executable', [], options)
    }),
    {
      code: 'ENATIVEDIALOG',
      message: 'The workspace progress dialog is unavailable.'
    }
  )
})
