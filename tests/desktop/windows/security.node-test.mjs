import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import {
  peImports,
  auditDependencies
} from '../../../apps/desktop/platform/windows/pe-dependencies.mjs'
import {
  validOwnerSession,
  serviceFailureCode,
  serviceStartupDiagnostic,
  bootstrapPhase,
  windowFailureDiagnostic,
  run
} from '../../../apps/desktop/platform/windows/services.mjs'
import { workspaceGate } from '../../../apps/desktop/platform/windows/session-gate.mjs'
import { windowsOnboarding } from '../../../apps/desktop/platform/windows/onboarding.mjs'
import { personalExport } from '../../../apps/desktop/platform/windows/export.mjs'
import { nativeFailureDiagnostic } from '../../../apps/desktop/platform/windows/native-command.mjs'

test('native helper failures retain only numeric status and fixed bounded categories', () => {
  assert.equal(
    nativeFailureDiagnostic('synthetic-private-body', 3221225794),
    'native-dll-initialization-failed-0xc0000142; exit-3221225794; sensitive output suppressed'
  )
  assert.equal(
    nativeFailureDiagnostic(
      'Failed to create CoreCLR synthetic-private-body',
      3221225781
    ),
    'native-runtime-load-refused; exit-3221225781; sensitive output suppressed'
  )
  assert.equal(
    nativeFailureDiagnostic(
      'Native OS operation failed; status 1314. synthetic-private-body',
      1
    ),
    'native-os-status-1314; exit-1; sensitive output suppressed'
  )
  assert.equal(
    nativeFailureDiagnostic(
      'x'.repeat(8192) + 'Native OS operation failed; status 5.',
      1
    ),
    'native-operation-refused; exit-1; sensitive output suppressed'
  )
})

test('service completion waits for pipe data after process exit', async () => {
  for (const exitCode of [0, 1]) {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough()
    })
    let settled = false
    const result = run('initdb.exe', [], {}, () => child)
    void result.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    child.emit('exit', exitCode)
    await new Promise((accept) => setImmediate(accept))
    assert.equal(settled, false)
    child.stdout.write('running bootstrap script ... ok\n')
    child.stderr.write(
      'could not read password from file "synthetic-private-path": Permission denied\n'
    )
    child.stdout.end()
    child.stderr.end()
    child.emit('close', exitCode)
    if (exitCode === 0) {
      assert.equal(await result, 'running bootstrap script ... ok\n')
    } else {
      await assert.rejects(result, (error) => {
        assert.equal(
          error.message,
          'initdb.exe exited 1; password-file-read-refused; bootstrap-script; sensitive output suppressed'
        )
        assert.equal(error.message.includes('synthetic-private-path'), false)
        assert.equal(error.serviceFailureCode, 'password-file-read-refused')
        assert.equal(error.serviceBootstrapPhase, 'bootstrap-script')
        assert.equal(error.serviceExecutable, 'initdb.exe')
        assert.equal(error.serviceExitCode, 1)
        assert.equal(error.postgresChildStatus, null)
        return true
      })
    }
  }
})

test('only initdb skips the redundant restricted-token relaunch', async () => {
  const launches = []
  const spawnChild = (file, args, options) => {
    launches.push({ file, args, options })
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough()
    })
    setImmediate(() => {
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 0)
    })
    return child
  }
  const inherited = {
    PATH: 'synthetic-path',
    PG_RESTRICT_EXEC: '0',
    pg_restrict_exec: 'hostile-case-variant'
  }

  await run('initdb.exe', [], { env: inherited }, spawnChild)
  await run('psql.exe', [], { env: inherited }, spawnChild)
  await run('initdb.exe', [], undefined, spawnChild)

  assert.deepEqual(launches[0].options.env, {
    PATH: 'synthetic-path',
    PG_RESTRICT_EXEC: '1'
  })
  assert.equal(launches[1].options.env, inherited)
  assert.equal(launches[2].options.env.PG_RESTRICT_EXEC, '1')
  assert.equal(launches[2].options.env.PATH, process.env.PATH)
  assert.deepEqual(
    Object.keys(launches[2].options.env).filter(
      (name) => name.toUpperCase() === 'PG_RESTRICT_EXEC'
    ),
    ['PG_RESTRICT_EXEC']
  )
  assert.deepEqual(inherited, {
    PATH: 'synthetic-path',
    PG_RESTRICT_EXEC: '0',
    pg_restrict_exec: 'hostile-case-variant'
  })
})

test('one-shot service failures retain only allowlisted executable and uint32 loader status', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  })
  const result = run('initdb.exe', [], {}, () => child)
  child.stderr.emit(
    'data',
    Buffer.from(
      'synthetic-private-path: child process exited with exit code 3221225794'
    )
  )
  child.stdout.emit(
    'data',
    Buffer.from('creating configuration files ... ok\n')
  )
  child.emit('close', 1)
  await assert.rejects(result, (error) => {
    assert.equal(error.serviceFailureCode, 'postgres-child-status-0xc0000142')
    assert.equal(error.serviceBootstrapPhase, 'configuration')
    assert.equal(error.serviceExecutable, 'initdb.exe')
    assert.equal(error.serviceExitCode, 1)
    assert.equal(error.postgresChildStatus, 3221225794)
    assert.equal(error.message.includes('synthetic-private-path'), false)
    return true
  })
})

test('service spawn failures suppress native error details and retain bounded metadata', async () => {
  for (const spawnChild of [
    () => {
      throw new Error('synthetic-private-sync-path')
    },
    () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough()
      })
      setImmediate(() =>
        child.emit('error', new Error('synthetic-private-async-path'))
      )
      return child
    }
  ]) {
    await assert.rejects(run('initdb.exe', [], {}, spawnChild), (error) => {
      assert.equal(
        error.message,
        'initdb.exe could not start; child-launch-failed; sensitive output suppressed'
      )
      assert.equal(error.serviceFailureCode, 'child-launch-failed')
      assert.equal(error.serviceBootstrapPhase, 'not-applicable')
      assert.equal(error.serviceExecutable, 'initdb.exe')
      assert.equal(error.serviceExitCode, null)
      assert.equal(error.postgresChildStatus, null)
      assert.equal(error.message.includes('synthetic-private'), false)
      return true
    })
  }
})

test('initialization permission diagnostics identify the operation without revealing its path', () => {
  for (const [message, category] of [
    ['could not read password from file', 'password-file-read-refused'],
    ['could not access directory', 'data-directory-access-refused'],
    ['could not create directory', 'data-directory-create-refused'],
    [
      'could not change permissions of directory',
      'data-directory-permissions-refused'
    ],
    [
      'could not open file "synthetic-private-path" for reading',
      'bootstrap-input-read-refused'
    ]
  ]) {
    assert.equal(
      serviceFailureCode(
        `${message} "synthetic-private-path": Permission denied`
      ),
      category
    )
  }
  assert.equal(
    serviceFailureCode('Permission denied synthetic-private-path'),
    'permission-refused'
  )
  for (const [message, category] of [
    [
      'could not access file "synthetic-private-path": Permission denied',
      'bootstrap-input-access-refused'
    ],
    [
      'Access is denied.\nprogram "postgres" is needed by initdb but was not found in the same directory as "synthetic-private-path"',
      'postgres-executable-unavailable-access-denied'
    ],
    [
      'program "postgres" was found by "synthetic-private-path" but was not the same version as initdb',
      'postgres-executable-unavailable'
    ],
    [
      'invalid binary "synthetic-private-path": Permission denied',
      'own-executable-unavailable-access-denied'
    ],
    ['could not open process token: error code 5', 'process-token-refused']
  ]) {
    const code = serviceFailureCode(message)
    assert.equal(code, category)
    assert.equal(code.includes('synthetic'), false)
  }
})

test('window failures report fixed coordinator categories without exposing renderer output', () => {
  for (const [text, code, expected] of [
    [
      'Unexpected packaged renderer request failure\n',
      1,
      'window-request-failure; exit-1; sensitive output suppressed'
    ],
    [
      'Invalid local session destination',
      1,
      'window-session-destination-invalid; exit-1; sensitive output suppressed'
    ],
    [
      'synthetic-private-path synthetic renderer status',
      3221225794,
      'window-unclassified; exit-0xC0000142; sensitive output suppressed'
    ],
    [
      'x'.repeat(9000) + 'Invalid local desktop configuration',
      1,
      'window-unclassified; exit-1; sensitive output suppressed'
    ],
    [
      'Error: Desktop setup reported a failure status: synthetic-private-path cannot be read',
      1,
      'window-setup-status-cannot; exit-1; sensitive output suppressed'
    ],
    [
      "Error: ERR_ABORTED (-3) loading 'http://127.0.0.1:1/synthetic-private-path'",
      1,
      'window-load-err-aborted; exit-1; sensitive output suppressed'
    ],
    [
      'TypeError: fetch failed',
      1,
      'window-coordinator-unreachable; exit-1; sensitive output suppressed'
    ],
    [
      'TypeError: synthetic-private-path is not a function',
      1,
      'window-unclassified-typeerror; exit-1; sensitive output suppressed'
    ],
    [
      '',
      null,
      'window-unclassified; exit-unavailable; sensitive output suppressed'
    ]
  ]) {
    const diagnostic = windowFailureDiagnostic(text, code)
    assert.equal(diagnostic, expected)
    assert.equal(diagnostic.includes('synthetic'), false)
  }
})

test('bootstrap status diagnostics retain numeric loader failures without exposing service output', () => {
  assert.equal(
    serviceFailureCode(
      'synthetic-private-path: child process exited with exit code 3221225781'
    ),
    'postgres-child-status-0xc0000135'
  )
  assert.equal(
    serviceFailureCode('child process exited with exit code 3221225794'),
    'postgres-child-status-0xc0000142'
  )
  assert.equal(
    serviceFailureCode('child process exited with exit code 1'),
    'postgres-child-exit-1'
  )
  assert.equal(
    serviceFailureCode('could not create restricted token: error code 5'),
    'restricted-token-unavailable'
  )
  assert.equal(
    serviceFailureCode('synthetic-private-body'),
    'unclassified-service-failure'
  )
  assert.equal(
    serviceFailureCode(
      'ERROR: invalid byte sequence for encoding "UTF8": 0xfc\nsynthetic-private-body'
    ),
    'postgres-input-utf8-0xfc'
  )
  assert.equal(
    serviceFailureCode('ERROR: syntax error'),
    'bootstrap-syntax-error'
  )
  assert.equal(
    bootstrapPhase(
      'running bootstrap script ... ok\nperforming post-bootstrap initialization ...'
    ),
    'post-bootstrap'
  )
  assert.equal(
    bootstrapPhase(
      'The files belonging to this database system will be owned by user "synthetic-private-user".\ncreating directory synthetic-private-path ... ok\ncreating subdirectories ... ok\nselecting dynamic shared memory implementation ... windows'
    ),
    'shared-memory'
  )
  assert.equal(
    bootstrapPhase(
      'The files belonging to this database system will be owned by user "synthetic-private-user".'
    ),
    'preflight'
  )
  assert.equal(
    bootstrapPhase('synthetic-private-body'),
    'bootstrap-phase-unavailable'
  )
})

test('startup streams emit only fixed categories and numeric status from a bounded prefix', () => {
  const child = {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 1
  }
  const diagnostic = serviceStartupDiagnostic(child)
  child.stderr.write(
    'synthetic-private-body: Execution of PostgreSQL by a user with administrative permissions is not\npermitted.\n'
  )
  assert.equal(
    diagnostic().split('; pgrst-')[0],
    'administrative-token-refused; exit-1'
  )
  assert.equal(diagnostic().includes('synthetic-private-body'), false)
  const bounded = {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 3221225781
  }
  const later = serviceStartupDiagnostic(bounded)
  bounded.stdout.write('x'.repeat(8192))
  bounded.stderr.write('permission denied synthetic-private-body')
  assert.equal(
    later(),
    'unclassified-service-failure; exit-3221225781; pgrst-unavailable; sqlstate-unavailable; streamComplete-false; capturedBytes-8192; truncated-true; sensitive output suppressed'
  )
})

test('expired native file choice resumes only its trusted destination after unlock without writing beforehand', async () => {
  let authorized = true,
    choices = 0,
    writes = 0
  const assertCurrent = () => {
    if (!authorized)
      throw Object.assign(new Error('Unlock required'), { code: 'ESESSION' })
  }
  const operation = personalExport({
    gate: {
      assertCurrent,
      expiresAt: () => {
        assertCurrent()
        return 1234567890000
      }
    },
    view: () => {
      assertCurrent()
      return { status: 'cached' }
    },
    native: async (args, input) => {
      if (args[0] === 'choose-export') {
        choices++
        authorized = false
        return { destination: 'C:\\synthetic chosen folder\\personal ü.json' }
      }
      writes++
      assert.deepEqual(args, [
        'export-personal',
        'C:\\synthetic chosen folder\\personal ü.json',
        '1234567890000'
      ])
      assert.deepEqual(JSON.parse(input), { status: 'cached' })
      return { exported: true, filename: 'personal ü.json' }
    }
  })
  await assert.rejects(operation(), { code: 'ESESSION' })
  assert.equal(writes, 0)
  await assert.rejects(operation(), { code: 'ESESSION' })
  assert.equal(choices, 1)
  authorized = true
  assert.equal((await operation()).exported, true)
  assert.equal(choices, 1)
  assert.equal(writes, 1)
})

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
      (error) => error.code === 'ESESSION'
    )
    assert.equal(accesses, 1)
    assert.equal(authCalls, 3)
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(join(root, 'official-onboarding.json')), false)
    assert.throws(gate.assertCurrent, (error) => error.code === 'ESESSION')
  } finally {
    await rm(root, { recursive: true, force: true })
    await new Promise((accept) => server.close(accept))
  }
})

test('legacy key forms and handlers cannot bypass native input after activation or through encoded paths', async () => {
  const { rendererCredentialSurface, holdCredentialSurface } =
    await import('../../../apps/desktop/platform/windows/credential-surface.mjs')
  for (const path of [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/signout',
    '/auth',
    '/AUTH/',
    '/auth/login',
    '/auth/signup',
    '/login',
    '/auth/change-password',
    '/auth/reset-password',
    '/api-keys',
    '/profile/edit',
    '/profile',
    '/onboarding/claim',
    '/token-usage',
    '/roster/SyntheticMember',
    '/guild-management/settings',
    '/guild-management/members',
    '/api/player-api-key',
    '/api/validate-api-key',
    '/api/player/test-api-key',
    '/api/onboarding/guild/start',
    '/api/members/request-api-key',
    '/api/profile/change-player-id',
    '/api/admin/player-api-key',
    '/clusters/create',
    '/api/clusters/create',
    '/api/clusters/join',
    '/api/guild/claim',
    '/api/guild/create-config',
    '/api/guild/initial-sync',
    '/api/guild/trigger-sync',
    '/api/guild-tokens/sync',
    '/api/guild-teams/backfill',
    '/api/player/roster',
    '/api/player/achievements',
    '/api/members/roster',
    '/api/tokens',
    '/api/roster-development/analysis',
    '/api/roster-development/member-gaps',
    '/api/meta/player-recommendations',
    '/api/guild-tokens?live=true',
    '/api/members/token-usage',
    '/api/guild-teams/tokens',
    '/api/guild-raid/unified-assignments',
    '/api/discord-webhooks/cap-notification',
    '/api/admin/diagnostics/synthetic-check',
    '/%70rofile/edit',
    '/PROFILE/edit',
    '/profile%5cedit',
    '/%2570rofile/edit',
    '/supabase/rest/v1/player_api_keys'
  ])
    assert.equal(
      rendererCredentialSurface(new URL(path, 'http://localhost')),
      true,
      path
    )
  for (const path of [
    '/desktop/setup',
    '/desktop/official-state',
    '/auth/callback',
    '/auth/error',
    '/authors',
    '/supabase/auth/v1/token',
    '/api/health',
    '/player-performance',
    '/api/guild-tokens',
    '/_next/static/app.js'
  ])
    assert.equal(
      rendererCredentialSurface(new URL(path, 'http://localhost')),
      false,
      path
    )
  let status, body
  const res = {
    writeHead(code) {
      status = code
    },
    end(text) {
      body = text
    }
  }
  assert.equal(
    holdCredentialSurface(
      { method: 'POST' },
      res,
      new URL('http://localhost/api/player-api-key')
    ),
    true
  )
  assert.equal(status, 501)
  assert.ok(JSON.parse(body).error.includes('native'))
  for (const path of [
    '/api/clusters/create',
    '/api/clusters/join',
    '/api/guild/create-config',
    '/api/guild/initial-sync'
  ]) {
    assert.equal(
      holdCredentialSurface(
        { method: 'POST' },
        res,
        new URL(path, 'http://localhost')
      ),
      true
    )
    assert.equal(status, 501)
  }
})

test('setup retries an expired native import once without a renderer login or bootstrap request', async () => {
  const elements = new Map()
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        textContent: '',
        events: {},
        addEventListener(name, callback) {
          this.events[name] = callback
        }
      })
    return elements.get(selector)
  }
  let imports = 0
  const state = {
    status: 'historical-offline',
    personal: {},
    capabilities: { Player: 'reconnect-required' }
  }
  const response = (value, ok = true) => ({ ok, json: async () => value })
  runInNewContext(
    await readFile(
      new URL(
        '../../../apps/desktop/platform/windows/windows-setup.js',
        import.meta.url
      ),
      'utf8'
    ),
    {
      document: { querySelector: element },
      fetch: async (path, options) => {
        if (path === '/desktop/official-state') return response(state)
        assert.equal(path, '/desktop/import-personal')
        assert.equal(options.body, '{}')
        imports++
        return imports === 1
          ? response(
              { code: 'ESESSION', error: 'Native session expired' },
              false
            )
          : response(state)
      }
    }
  )
  await new Promise(setImmediate)
  await element('#import').events.click()
  assert.equal(imports, 2)
  assert.ok(element('#status').textContent.includes('historical-offline'))
  assert.equal(
    [...elements.keys()].some((key) => /password|unlock/.test(key)),
    false
  )
})
