import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import {
  peImports,
  auditDependencies
} from '../../../apps/desktop/platform/windows/pe-dependencies.mjs'
import { validOwnerSession } from '../../../apps/desktop/platform/windows/services.mjs'
import { workspaceGate } from '../../../apps/desktop/platform/windows/session-gate.mjs'
import { windowsOnboarding } from '../../../apps/desktop/platform/windows/onboarding.mjs'

function pe(dll) {
  const bytes = Buffer.alloc(1024)
  bytes.writeUInt16LE(0x5a4d, 0)
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.writeUInt32LE(0x4550, 0x80)
  bytes.writeUInt16LE(0x8664, 0x84)
  bytes.writeUInt16LE(1, 0x86)
  bytes.writeUInt16LE(240, 0x94)
  bytes.writeUInt16LE(0x20b, 0x98)
  bytes.writeUInt32LE(0x1000, 0x98 + 120)
  const section = 0x98 + 240
  bytes.writeUInt32LE(512, section + 8)
  bytes.writeUInt32LE(0x1000, section + 12)
  bytes.writeUInt32LE(512, section + 16)
  bytes.writeUInt32LE(512, section + 20)
  bytes.writeUInt32LE(0x1040, 512 + 12)
  bytes.write(dll, 576, 'ascii')
  return bytes
}
test('PE audit refuses missing developer runtime, traversal names and corrupt import tables', async () => {
  assert.deepEqual(peImports(pe('VCRUNTIME140.dll')), ['vcruntime140.dll'])
  assert.throws(() => peImports(pe('../evil.dll')), /Unsafe/)
  const broken = pe('kernel32.dll')
  broken.writeUInt32LE(0x99999999, 524)
  assert.throws(() => peImports(broken), /RVA/)
  assert.throws(
    () => peImports(pe('kernel32.dll').subarray(0, 570)),
    /Truncated|limit/
  )
  const root = await mkdtemp(join(tmpdir(), 'Windows PE ü '))
  try {
    await mkdir(join(root, 'bin'))
    await writeFile(join(root, 'bin/node.exe'), pe('VCRUNTIME140.dll'))
    const files = [{ path: 'bin/node.exe' }]
    await assert.rejects(
      auditDependencies(root, files),
      /Unbundled.*vcruntime140/
    )
    await writeFile(join(root, 'bin/vcruntime140.dll'), Buffer.alloc(64))
    const result = await auditDependencies(root, [
      ...files,
      { path: 'bin/vcruntime140.dll' }
    ])
    assert.equal(result.unresolvedThirdPartyDlls, 0)
    assert.equal(result.checkedFiles, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
const key = 'synthetic-signing-key',
  subject = '00000000-0000-4000-8000-000000000001'
function token(exp, sub = subject, alg = 'HS256') {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg })}.${encode({ sub, role: 'authenticated', exp })}`
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}
test('owner session requires a real signature, matching owner and unexpired claims', () => {
  const expiry = Math.floor(Date.now() / 1000) + 300
  assert.equal(validOwnerSession(token(expiry), subject, key), true)
  for (const value of [
    token(0),
    token(expiry, '00000000-0000-4000-8000-000000000002'),
    token(expiry, subject, 'none'),
    token(expiry) + 'forged',
    'malformed'
  ])
    assert.equal(validOwnerSession(value, subject, key), false)
})
test('current native session is checked by local Auth before vault access, and expiry during native prompt prevents projection writes', async () => {
  let authOwner = subject,
    live = true,
    accesses = 0,
    authCalls = 0
  const server = createServer((req, res) => {
    assert.equal(req.url, '/user')
    authCalls++
    assert.ok(req.headers.authorization.startsWith('Bearer '))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: authOwner }))
  })
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
  const root = await mkdtemp(join(tmpdir(), 'Windows session ü '))
  try {
    const current = token(Math.floor(Date.now() / 1000) + 300)
    const gate = workspaceGate({
      services: {
        ports: { auth: server.address().port },
        validOwnerSession: (value, owner) =>
          live && validOwnerSession(value, owner, key)
      },
      brokerToken: 'a'.repeat(64),
      currentToken: async () => current,
      owner: async () => subject
    })
    const guard = windowsOnboarding(
      root,
      async () => {
        accesses++
        live = false
        return { handle: 'b'.repeat(32) }
      },
      gate.assertCurrent
    )
    authOwner = '00000000-0000-4000-8000-000000000002'
    await assert.rejects(
      gate.run(() => guard.connect({})),
      (error) => error.code === 'ESESSION'
    )
    assert.equal(accesses, 0)
    authOwner = subject
    await assert.rejects(
      gate.run(() => guard.connect({})),
      /Secure onboarding|Unlock/
    )
    assert.equal(accesses, 1)
    assert.equal(authCalls, 2)
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(join(root, 'official-onboarding.json')), false)
    assert.throws(gate.assertCurrent, (error) => error.code === 'ESESSION')
  } finally {
    await rm(root, { recursive: true, force: true })
    await new Promise((accept) => server.close(accept))
  }
})
