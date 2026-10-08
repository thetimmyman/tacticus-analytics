import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  electronControlPins,
  runNavigationControl
} from '../../../apps/desktop/platform/macos/navigation-control.mjs'

test(
  'pinned sandboxed native Electron compares intercepted gateway navigation with complete/truncated baselines',
  {
    skip:
      process.platform !== 'darwin'
        ? 'Native macOS Electron control unavailable on this host'
        : false,
    timeout: 300000
  },
  async (t) => {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim()
    const root = await mkdtemp(join(tmpdir(), 'ta-navigation-control-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    let response
    try {
      response = await fetch(
        `https://github.com/electron/electron/releases/download/v44.5.1/electron-v44.5.1-darwin-${process.arch}.zip`,
        { signal: AbortSignal.timeout(180000) }
      )
      if (!response.ok) throw new Error()
    } catch {
      console.log(
        'TA-MAC-NAVIGATION-CONTROL:' +
          JSON.stringify({
            sourceCommit,
            available: false,
            reason: 'pinned-native-runtime-download-unavailable',
            classification: 'diagnostic',
            accepted: false
          })
      )
      t.skip(
        'Pinned native runtime unavailable; installed package control remains required'
      )
      return
    }
    const chunks = [],
      reader = response.body.getReader()
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 250 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('Native control runtime size limit')
      }
      chunks.push(value)
    }
    const bytes = Buffer.concat(chunks)
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      electronControlPins[process.arch]
    )
    const archive = join(root, 'electron.zip'),
      unpacked = join(root, 'electron')
    await writeFile(archive, bytes, { mode: 0o600 })
    await mkdir(unpacked, { mode: 0o700 })
    execFileSync('/usr/bin/ditto', ['-x', '-k', archive, unpacked], {
      stdio: 'ignore'
    })
    const result = await runNavigationControl({
      electron: join(unpacked, 'Electron.app/Contents/MacOS/Electron'),
      guard: process.env.MAC_GUARD,
      output: join(root, 'control.json'),
      sourceCommit
    })
    console.log(
      'TA-MAC-NAVIGATION-CONTROL:' +
        JSON.stringify({ available: true, ...result })
    )
  }
)
