import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import diagnostics from '../../../apps/desktop/platform/macos/request-diagnostics.cjs'

test('failure-only labels distinguish native access and exact public chrome destinations', () => {
  for (const [path, endpoint] of [
    ['/desktop/onboarding-status', 'workspace-access-status'],
    ['/desktop/setup', 'workspace-setup-page'],
    ['/desktop/connect', 'workspace-connect-page'],
    ['/desktop/import', 'workspace-import-page'],
    ['/home', 'home-page'],
    ['/boss-assignments', 'boss-assignments-page'],
    ['/guild-teams', 'guild-teams-page'],
    ['/downloads', 'downloads-page'],
    ['/auth/login', 'login-page']
  ]) {
    const label = diagnostics.networkRequestLabel(path, 'xhr', 'scores-view')
    assert.equal(label.diagnosticEndpoint, endpoint)
    assert.deepEqual(
      diagnostics.rendererReceipt({ failed: [{ ...label, status: 0 }] }),
      diagnostics.rendererReceipt({
        failed: [
          { ...diagnostics.requestLabel(path, 'xhr', 'scores-view'), status: 0 }
        ]
      })
    )
  }
  for (const path of [
    '/home/unknown',
    '/boss-assignments/unknown',
    '/desktop/onboarding-status/unknown',
    '/home?secret=synthetic',
    '/home#secret',
    '//home'
  ])
    assert.equal(
      diagnostics.networkRequestLabel(path, 'xhr', 'scores-view')
        .diagnosticEndpoint,
      'other-local'
    )
})

test('request kind reads only exact own standard indicators without copying arbitrary header values', () => {
  for (const [headers, kind] of [
    [{ RSC: '1', 'Next-Router-Prefetch': '1' }, 'rsc-prefetch'],
    [{ rsc: '1', purpose: 'prefetch' }, 'rsc-prefetch'],
    [{ Rsc: '1' }, 'rsc'],
    [{ 'next-router-prefetch': '1' }, 'prefetch'],
    [{ Purpose: 'prefetch' }, 'prefetch'],
    [{ RSC: '0', purpose: 'prefetch' }, 'prefetch'],
    [{ RSC: true, Purpose: 'PREFETCH' }, 'other'],
    [{ RSC: ['1'], 'Next-Router-Prefetch': ['1'] }, 'other'],
    [{ RSC: '1 extra', purpose: 'prefetch extra' }, 'other'],
    [{ RSC: '1', rsc: '1' }, 'other'],
    [Object.create({ RSC: '1', Purpose: 'prefetch' }), 'other'],
    [null, 'other'],
    [[], 'other']
  ])
    assert.equal(diagnostics.requestKind(headers), kind)
  const headers = { RSC: '1' }
  Object.defineProperty(headers, 'Authorization', {
    enumerable: true,
    get() {
      throw new Error('Unknown header must not be read')
    }
  })
  Object.defineProperty(headers, 'Cookie', {
    enumerable: true,
    get() {
      throw new Error('Unknown header must not be read')
    }
  })
  assert.equal(diagnostics.requestKind(headers), 'rsc')
  const accessor = Object.defineProperty({}, 'RSC', {
    enumerable: true,
    get() {
      throw new Error('Header getter must not execute')
    }
  })
  assert.equal(diagnostics.requestKind(accessor), 'other')
})

test('optional request-kind projection is closed, failure-only and survives the owner sanitizer', () => {
  for (const kind of [
    'rsc-prefetch',
    'rsc',
    'prefetch',
    'other',
    'SYNTHETIC-UNKNOWN-CANARY'
  ]) {
    const row = {
      ...diagnostics.networkRequestLabel('/home', 'xhr', 'scores-view'),
      requestKind: kind,
      status: 0,
      errorCategory: 'ERR_FAILED'
    }
    const value = diagnostics.sanitizeFailure({
      stage: 'renderer-network',
      cause: 'request-failed',
      network: { failed: [row] },
      networkDiagnostics: { schemaVersion: 1, failed: [row] }
    })
    assert.equal(
      value.networkDiagnostics.failed[0].requestKind,
      kind === 'SYNTHETIC-UNKNOWN-CANARY' ? 'other' : kind
    )
    assert.deepEqual(diagnostics.sanitizeFailure(value), value)
    assert.equal(
      JSON.stringify(value).includes('SYNTHETIC-UNKNOWN-CANARY'),
      false
    )
    assert.equal(value.network.failed[0].requestKind, undefined)
    assert.equal(
      diagnostics.rendererReceipt({ failed: [row] }).networkDiagnostics,
      undefined
    )
  }
})

test('network failure adds closed endpoint and Chromium error diagnostics that survive relay sanitization', () => {
  const failed = {
    ...diagnostics.networkRequestLabel(
      '/supabase/rest/v1/rpc/get_distinct_seasons_for_guild',
      'xhr',
      'scores-view'
    ),
    status: 0,
    errorCategory: diagnostics.chromiumErrorCategory(
      'net::ERR_CONNECTION_RESET'
    )
  }
  const value = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: { failed: [failed] },
    networkDiagnostics: { schemaVersion: 1, failed: [failed] }
  })
  assert.deepEqual(value.network.failed, [
    {
      endpoint: 'other-local',
      resource: 'xhr',
      phase: 'scores-view',
      status: 0
    }
  ])
  assert.deepEqual(value.networkDiagnostics, {
    schemaVersion: 1,
    truncated: false,
    pending: [],
    failed: [
      {
        endpoint: 'season-list',
        requestClass: 'supabase-rpc',
        resource: 'xhr',
        phase: 'scores-view',
        status: 0,
        errorCategory: 'ERR_CONNECTION_RESET'
      }
    ]
  })
  assert.deepEqual(diagnostics.sanitizeFailure(value), value)
})

test('failure diagnostics drop raw fields and normalize unknown values on every relay', () => {
  const canary = 'SYNTHETIC-UNKNOWN-CANARY'
  const row = {
    endpoint: canary,
    diagnosticEndpoint: canary,
    requestClass: canary,
    resource: canary,
    phase: canary,
    status: canary,
    errorCategory: canary,
    url: canary,
    path: canary,
    headers: { authorization: canary },
    cookie: canary,
    body: canary,
    requestId: canary
  }
  const value = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    networkDiagnostics: {
      schemaVersion: 1,
      arbitrary: canary,
      pending: [row],
      failed: [row]
    }
  })
  assert.equal(JSON.stringify(value).includes(canary), false)
  assert.deepEqual(value.networkDiagnostics, {
    schemaVersion: 1,
    truncated: false,
    pending: [
      {
        endpoint: 'other-local',
        requestClass: 'other-local',
        resource: 'other'
      }
    ],
    failed: [
      {
        endpoint: 'other-local',
        requestClass: 'other-local',
        resource: 'other',
        status: 0,
        errorCategory: 'other'
      }
    ]
  })
  assert.deepEqual(diagnostics.sanitizeFailure(value), value)
  for (const schemaVersion of [undefined, true, '1', 0, 2]) {
    assert.equal(
      diagnostics.sanitizeFailure({
        stage: 'renderer-network',
        cause: 'request-failed',
        networkDiagnostics: { schemaVersion, failed: [row] }
      }).networkDiagnostics,
      undefined
    )
  }
  assert.equal(
    diagnostics.sanitizeFailure({
      stage: 'native-session',
      cause: 'request-failed',
      networkDiagnostics: { schemaVersion: 1, failed: [row] }
    }).networkDiagnostics,
    undefined
  )
})

test('fixed classes and exact Chromium codes never forward unknown path or error text', () => {
  for (const [path, requestClass] of [
    ['/supabase/rest/v1/rpc/unknown', 'supabase-rpc'],
    ['/supabase/auth/v1/user', 'supabase-auth'],
    ['/supabase/rest/v1/unknown', 'supabase-table'],
    ['/api/unknown', 'local-api'],
    ['/_next/static/unknown', 'next-static'],
    ['/_next/unknown', 'next-internal'],
    ['/player-performance', 'local-page'],
    ['/unknown', 'other-local'],
    ['//unknown', 'other-local'],
    ['/api/unknown?canary=1', 'other-local'],
    ['/api/unknown#canary', 'other-local']
  ])
    assert.equal(
      diagnostics.networkRequestLabel(path, 'xhr', 'scores-view').requestClass,
      requestClass
    )
  for (const code of [
    'ERR_ABORTED',
    'ERR_BLOCKED_BY_CLIENT',
    'ERR_FAILED',
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_REFUSED',
    'ERR_NETWORK_CHANGED',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_TIMED_OUT',
    'ERR_EMPTY_RESPONSE',
    'ERR_NAME_NOT_RESOLVED'
  ])
    assert.equal(diagnostics.chromiumErrorCategory('net::' + code), code)
  for (const input of [
    undefined,
    null,
    {},
    0,
    'ERR_FAILED',
    'net::ERR_FAILED extra',
    ' net::ERR_FAILED'
  ])
    assert.equal(diagnostics.chromiumErrorCategory(input), 'other')
})

test('failure diagnostic bounds and HTTP categories remain finite and idempotent', () => {
  const label = diagnostics.networkRequestLabel(
    '/api/version',
    'xhr',
    'scores-view'
  )
  const input = {
    stage: 'renderer-network',
    cause: 'request-failed',
    networkDiagnostics: {
      schemaVersion: 1,
      pending: Array(1000).fill(label),
      failed: Array.from({ length: 1000 }, (_, status) => ({
        ...label,
        status,
        errorCategory: 'ERR_FAILED'
      }))
    }
  }
  const value = diagnostics.sanitizeFailure(input)
  assert.equal(value.networkDiagnostics.pending.length, 1)
  assert.equal(value.networkDiagnostics.failed.length, 20)
  assert.equal(value.networkDiagnostics.failed[0].errorCategory, 'ERR_FAILED')
  assert.equal(
    value.networkDiagnostics.failed[1].errorCategory,
    'not-applicable'
  )
  assert.deepEqual(diagnostics.sanitizeFailure(value), value)
  for (const status of [true, '0', -1, 600, NaN, Infinity]) {
    const projected = diagnostics.sanitizeFailure({
      ...input,
      networkDiagnostics: {
        schemaVersion: 1,
        failed: [{ ...label, status, errorCategory: 'ERR_FAILED' }]
      }
    }).networkDiagnostics.failed[0]
    assert.equal(projected.status, 0)
    assert.equal(projected.errorCategory, 'other')
  }
})

test('additional internal labels leave the original success renderer shape unchanged', () => {
  const argumentsFor = (label) => ({
    observed: { text: '+58% -50%', nodeAccess: false },
    pending: [],
    blocked: 0,
    failed: [{ ...label, status: 401, errorCategory: 'ERR_FAILED' }]
  })
  const path = '/supabase/rest/v1/rpc/get_distinct_seasons_for_guild'
  const before = diagnostics.rendererReceipt(
    argumentsFor(diagnostics.requestLabel(path, 'xhr', 'signed-out-check'))
  )
  const after = diagnostics.rendererReceipt(
    argumentsFor(
      diagnostics.networkRequestLabel(path, 'xhr', 'signed-out-check')
    )
  )
  assert.deepEqual(after, before)
  assert.equal(after.networkDiagnostics, undefined)
  assert.deepEqual(after.network.failed, [
    {
      endpoint: 'other-local',
      resource: 'xhr',
      phase: 'signed-out-check',
      status: 401
    }
  ])
})

test('failure relay stays within its complete line budget without changing legacy network evidence', () => {
  const failed = Array.from({ length: 20 }, (_, index) => ({
    endpoint: 'official-access-page',
    resource: 'stylesheet',
    phase: 'renderer-refusal',
    status: 500 + index,
    diagnosticEndpoint: 'official-access-page',
    requestClass: 'local-page'
  }))
  const pending = []
  for (const phase of ['renderer-refusal', 'signed-out-check'])
    for (const resource of [
      'mainFrame',
      'subFrame',
      'stylesheet',
      'script',
      'image',
      'font',
      'object',
      'xhr',
      'ping',
      'cspReport'
    ])
      pending.push({
        endpoint: 'official-access-page',
        resource,
        phase,
        diagnosticEndpoint: 'official-access-page',
        requestClass: 'local-page'
      })
  const input = {
    stage: 'renderer-network',
    code: 'EVERIFY',
    cause: 'request-failed',
    network: { pending, failed, blocked: 1000000 }
  }
  const before = diagnostics.sanitizeFailure(input)
  const value = diagnostics.sanitizeFailure({
    ...input,
    networkDiagnostics: { schemaVersion: 1, pending, failed }
  })
  assert.ok(
    Buffer.byteLength(
      'TA-MAC-VERIFY-FAILURE:' + JSON.stringify(value) + '\n'
    ) <= 4096
  )
  assert.deepEqual(value.network, before.network)
  assert.equal(value.networkDiagnostics.truncated, true)
  assert.equal(value.networkDiagnostics.pending.length, 0)
  assert.deepEqual(diagnostics.sanitizeFailure(value), value)
})

test('pending and failed requests retain fixed endpoint/resource labels and distinct causes', () => {
  assert.deepEqual(diagnostics.requestLabel('/api/user/activity', 'xhr'), {
    endpoint: 'activity',
    resource: 'xhr'
  })
  const pending = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'requests-pending',
    network: {
      pending: [
        diagnostics.requestLabel('/_next/static/synthetic-secret.js', 'script')
      ]
    }
  })
  assert.equal(pending.cause, 'requests-pending')
  assert.deepEqual(pending.network.pending, [
    { endpoint: 'static-asset', resource: 'script' }
  ])
  const failed = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: {
      failed: [
        { ...diagnostics.requestLabel('/api/version', 'xhr'), status: 500 }
      ],
      blocked: 2
    }
  })
  assert.deepEqual(failed.network.failed, [
    { endpoint: 'version', resource: 'xhr', status: 500 }
  ])
  assert.equal(failed.network.blocked, 2)
})

test('untrusted diagnostic frames cannot copy paths, messages, cookies or arbitrary labels', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const entry = {
    endpoint: canary,
    resource: canary,
    status: canary,
    path: '/' + canary,
    cookie: canary,
    phase: canary
  }
  const input = {
    stage: 'renderer-network',
    cause: 'request-failed',
    code: canary,
    message: canary,
    network: {
      pending: Array(1000).fill(entry),
      failed: Array(1000).fill(entry),
      blocked: canary
    }
  }
  const result = diagnostics.sanitizeFailure(input)
  assert.equal(JSON.stringify(result).includes(canary), false)
  assert.deepEqual(result.network.failed, [
    { endpoint: 'other-local', resource: 'other', status: 0 }
  ])
  assert.deepEqual(diagnostics.sanitizeFailure({ ...input, cause: canary }), {
    synthetic: true,
    stage: 'renderer-network',
    code: 'EVERIFY'
  })
  assert.equal(
    JSON.stringify(
      diagnostics.requestLabel('/private/' + canary, canary)
    ).includes(canary),
    false
  )
})

test('request start phases and known local readers survive projection without copying arbitrary paths', () => {
  const label = diagnostics.requestLabel(
    '/supabase/rest/v1/player_with_cluster',
    'xhr',
    'signed-out-check'
  )
  assert.deepEqual(label, {
    endpoint: 'cluster-profile',
    resource: 'xhr',
    phase: 'signed-out-check'
  })
  const value = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: { failed: [{ ...label, status: 401 }] }
  })
  assert.deepEqual(value.network.failed, [{ ...label, status: 401 }])
  assert.deepEqual(
    diagnostics.requestLabel('/unknown', 'xhr', 'SYNTHETIC-SECRET-CANARY'),
    { endpoint: 'other-local', resource: 'xhr' }
  )
})

test('renderer attachment projects calculation flags without document text or request paths', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const value = diagnostics.rendererReceipt({
    observed: { text: '+58% -50% ' + canary, nodeAccess: false },
    failed: [{ path: '/private/' + canary, status: 500 }],
    blocked: 1
  })
  assert.equal(JSON.stringify(value).includes(canary), false)
  assert.deepEqual(value.observed, {
    nodeAccess: false,
    positiveScore: true,
    negativeScore: true,
    serviceDisruption: false
  })
  assert.deepEqual(value.network.failed, [
    { endpoint: 'other-local', resource: 'other', status: 500 }
  ])
  assert.equal(diagnostics.rendererReceipt({}).observed.nodeAccess, true)
  assert.equal(diagnostics.rendererReceipt({}).observed.serviceDisruption, true)
})

test('only the tagged credential holding refusal is treated as deliberate', () => {
  const tagged = { [diagnostics.holdingHeader]: ['credential-surface'] }
  assert.equal(diagnostics.holdingRefusal(403, tagged), true)
  assert.equal(
    diagnostics.holdingRefusal(403, {
      'X-Desktop-Holding': 'credential-surface'
    }),
    true
  )
  assert.equal(diagnostics.holdingRefusal(403, {}), false)
  assert.equal(diagnostics.holdingRefusal(500, tagged), false)
  assert.equal(
    diagnostics.holdingRefusal(403, { [diagnostics.holdingHeader]: ['other'] }),
    false
  )
})

test('authorization failures are expected only while deliberately signed out', () => {
  const failure = (path, status, phase) => ({ path, status, phase })
  for (const expected of [
    failure('/desktop/open', 403, 'renderer-refusal'),
    failure('/api/guild-tokens', 403, 'scores-view'),
    failure('/supabase/rest/v1/guild_config', 401, 'signed-out-check')
  ])
    assert.equal(diagnostics.unexpectedFailure(expected), false)
  for (const unexpected of [
    failure('/supabase/rest/v1/guild_config', 401, 'recovered-open'),
    failure('/supabase/rest/v1/guild_config', 401, 'scores-view'),
    failure('/supabase/rest/v1/guild_config', 401, 'initial-open'),
    failure('/profile', 403, 'scores-view'),
    failure('/player-performance', 500, 'scores-view'),
    failure('/api/guild-tokens', 0, 'scores-view')
  ])
    assert.equal(diagnostics.unexpectedFailure(unexpected), true)
})

// Run the real main entry and session modules. Only Electron's native boundary
// and the owner IPC reply are inert; no HTTP/PG/renderer execution is claimed.
function mainJourney401(mode) {
  const directory = mkdtempSync(join(tmpdir(), 'ta-signed-out-boundary-'))
  try {
    const evidence = join(directory, 'evidence.json')
    const config = join(directory, 'config.json')
    const facade = join(directory, 'electron-facade.cjs')
    writeFileSync(
      config,
      JSON.stringify({
        url: 'http://127.0.0.1:34567/desktop/setup',
        brokerToken: 'a'.repeat(64),
        transportKey: 'b'.repeat(64),
        state: directory,
        verify: { evidence, screenshot: join(directory, 'frame.png') }
      })
    )
    writeFileSync(
      facade,
      `
const { EventEmitter } = require('node:events')
const { createHmac } = require('node:crypto')
const Module = require('node:module')
const mode = process.env.SYNTHETIC_PHASE_CASE
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const user = '00000000-0000-4000-8000-000000000001'
const body = encode({alg:'HS256'}) + '.' + encode({sub:user,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})
const token = body + '.' + createHmac('sha256','synthetic-phase-key').update(body).digest('base64url')
const grant = {access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user:{id:user}}
const origin = 'http://127.0.0.1:34567'
const hooks = {}, cookies = []
let openCount = 0, delayed = false, window
function start(id) {
  hooks.onBeforeRequest({id,url:origin+'/supabase/rest/v1/guild_config',resourceType:'xhr'}, result => {
    if (result.cancel) throw new Error('Synthetic request unexpectedly blocked')
  })
}
function complete(id) {
  hooks.onCompleted({id,url:origin+'/supabase/rest/v1/guild_config',resourceType:'xhr',statusCode:401,responseHeaders:{}})
}
const nativeCookies = {
  async get() { return [...cookies] },
  async remove(_url,name) {
    const index = cookies.findIndex(cookie => cookie.name === name)
    if (index >= 0) cookies.splice(index,1)
    if (openCount===1 && mode==='delayed-signed-out' && !delayed) {
      delayed=true
      start(3)
    }
  },
  async set(cookie) {
    if (openCount===2 && mode==='installing') { start(1); complete(1) }
    cookies.push(cookie)
  }
}
const webRequest = Object.fromEntries(['onBeforeRequest','onBeforeSendHeaders','onCompleted','onErrorOccurred'].map(name => [name, callback => {hooks[name]=callback}]))
const defaultSession = {setPermissionRequestHandler(){},webRequest,cookies:nativeCookies}
class BrowserWindow extends EventEmitter {
  constructor() {
    super(); window=this
    this.webContents=new EventEmitter()
    Object.assign(this.webContents, {
      session:defaultSession,
      setWindowOpenHandler(){},
      getURL(){return origin+'/desktop/personal'},
      executeJavaScript:async source => source.includes("fetch('/desktop/open'") ? true : {text:'+58% -50%',nodeAccess:false},
      capturePage:async () => ({toPNG:() => Buffer.from('synthetic-inert-frame')})
    })
  }
  async loadURL(url) {
    if (url===origin+'/player-performance?guild=SYN001&season=9999' && mode.startsWith('network-')) {
      const path = mode==='network-native-kind' ? '/desktop/onboarding-status'
        : mode==='network-page-kind' ? '/boss-assignments' : '/supabase/rest/v1/rpc/get_distinct_seasons_for_guild'
      const url=origin+path
      hooks.onBeforeRequest({id:4,url,resourceType:'xhr'},()=>{})
      if (mode==='network-native-kind' || mode==='network-page-kind') {
        const headers = mode==='network-native-kind' ? { RSC:'1', 'Next-Router-Prefetch':'1' } : { Purpose:'prefetch' }
        hooks.onBeforeSendHeaders({id:4,url,requestHeaders:headers}, result => {
          if(result.requestHeaders['x-desktop-transport']!=='b'.repeat(64)) throw new Error('Synthetic transport header missing')
        })
      }
      const error = mode==='network-native-kind' || mode==='network-page-kind' ? 'net::ERR_FAILED'
        : mode==='network-reset' ? 'net::ERR_CONNECTION_RESET'
        : mode==='network-aborted' ? 'net::ERR_ABORTED' : 'SYNTHETIC-UNKNOWN-CANARY'
      hooks.onErrorOccurred({id:4,url,resourceType:'xhr',error})
    }
    if(openCount===2 && url===origin+'/desktop/personal') {
      if(mode==='recovered') { start(2); complete(2) }
      if(mode==='delayed-signed-out') complete(3)
    }
    this.webContents.emit('did-navigate',{},url)
  }
  isDestroyed(){return false}
  destroy(){this.emit('closed')}
}
const app = new EventEmitter()
Object.assign(app, {enableSandbox(){},disableHardwareAcceleration(){},setPath(){},commandLine:{appendSwitch(){}},whenReady:async()=>{},quit(){},exit:code=>{process.exitCode=code}})
const electron = {
  app,BrowserWindow,
  session:{defaultSession,fromPartition(){return {
    setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){},onBeforeSendHeaders(){}},
    async fetch(){openCount++;return new Response(JSON.stringify({session:grant,destination:'/desktop/personal'}))}
  }}},
  Menu:{setApplicationMenu(){},buildFromTemplate:items=>items},
  dialog:{showMessageBox:async()=>({})},
  net:{fetch:async()=>{throw new Error('net::ERR_BLOCKED_BY_CLIENT')}}
}
const load = Module._load
Module._load = function(name,...args) {return name==='electron' ? electron : load.call(this,name,...args)}
process.send = (request,callback) => {
  queueMicrotask(()=>process.emit('message',{requestId:request.requestId,status:'ok',view:{cloudContribution:'separate-consent-required'}}))
  callback()
}
const timeout = global.setTimeout
global.setTimeout = (callback,milliseconds,...args) => milliseconds===10000 ? timeout(callback,0,...args) : timeout(callback,milliseconds,...args)
`
    )
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        facade,
        fileURLToPath(
          new URL(
            '../../../apps/desktop/platform/macos/main.cjs',
            import.meta.url
          )
        ),
        config
      ],
      {
        env: { ...process.env, SYNTHETIC_PHASE_CASE: mode },
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 65536
      }
    )
    assert.equal(result.signal, null)
    assert.equal(result.error, undefined)
    const receipt = JSON.parse(readFileSync(evidence, 'utf8'))
    const failure =
      result.status === 0
        ? null
        : JSON.parse(readFileSync(evidence + '.failure.json', 'utf8'))
    return { exitCode: result.status, receipt, failure }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('actual main refuses 401 after recovery cookies are installed, before reload completes', () => {
  const result = mainJourney401('recovered')
  assert.equal(result.exitCode, 1)
  assert.equal(result.failure.cause, 'request-failed')
  assert.deepEqual(result.receipt.network.failed, [
    {
      endpoint: 'guild-config',
      resource: 'xhr',
      phase: 'recovered-open',
      status: 401
    }
  ])
})

test('actual main allows 401 before final cookie installation and keeps late completion tied to its signed-out start', () => {
  for (const mode of ['installing', 'delayed-signed-out']) {
    const result = mainJourney401(mode)
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.receipt.network.failed, [
      {
        endpoint: 'guild-config',
        resource: 'xhr',
        phase: 'signed-out-check',
        status: 401
      }
    ])
  }
})

test('actual main keeps status-zero requests fatal while exporting only closed failure diagnostics', () => {
  for (const [mode, errorCategory] of [
    ['network-reset', 'ERR_CONNECTION_RESET'],
    ['network-unknown', 'other']
  ]) {
    const result = mainJourney401(mode)
    assert.equal(result.exitCode, 1)
    assert.equal(result.failure.cause, 'request-failed')
    assert.deepEqual(result.failure.networkDiagnostics.failed, [
      {
        endpoint: 'season-list',
        requestClass: 'supabase-rpc',
        resource: 'xhr',
        phase: 'scores-view',
        status: 0,
        errorCategory
      }
    ])
    assert.deepEqual(
      diagnostics.sanitizeFailure(result.failure),
      result.failure
    )
    assert.equal(
      JSON.stringify(result.failure).includes('SYNTHETIC-UNKNOWN-CANARY'),
      false
    )
    assert.equal(result.receipt.networkDiagnostics, undefined)
    assert.deepEqual(result.receipt.network.failed, [
      {
        endpoint: 'other-local',
        resource: 'xhr',
        phase: 'scores-view',
        status: 0
      }
    ])
  }
})

test('actual main retains the original aborted-request exclusion and success shape', () => {
  const result = mainJourney401('network-aborted')
  assert.equal(result.exitCode, 0)
  assert.equal(result.failure, null)
  assert.deepEqual(result.receipt.network, {
    pending: [],
    failed: [],
    blocked: 0
  })
  assert.equal(result.receipt.networkDiagnostics, undefined)
})

test('actual main tags tracked native and page requests from standard headers while keeping status zero fatal', () => {
  for (const [mode, endpoint, requestKind] of [
    ['network-native-kind', 'workspace-access-status', 'rsc-prefetch'],
    ['network-page-kind', 'boss-assignments-page', 'prefetch']
  ]) {
    const result = mainJourney401(mode)
    assert.equal(result.exitCode, 1)
    assert.equal(result.failure.cause, 'request-failed')
    assert.deepEqual(result.failure.networkDiagnostics.failed, [
      {
        endpoint,
        requestClass: 'other-local',
        resource: 'xhr',
        phase: 'scores-view',
        requestKind,
        status: 0,
        errorCategory: 'ERR_FAILED'
      }
    ])
    assert.deepEqual(
      diagnostics.sanitizeFailure(result.failure),
      result.failure
    )
    assert.deepEqual(result.receipt.network.failed, [
      {
        endpoint: 'other-local',
        resource: 'xhr',
        phase: 'scores-view',
        status: 0
      }
    ])
    assert.equal(result.receipt.networkDiagnostics, undefined)
  }
})

test('current static internal chrome destinations all have fixed failure labels without changing success fields', () => {
  const chrome = readFileSync(
    new URL(
      '../../../app/components/navigation/workspaces.ts',
      import.meta.url
    ),
    'utf8'
  )
  const paths = new Set(
    [...chrome.matchAll(/\bhref:\s*'(\/[^']*)'/g)].map(
      (match) => match[1].split('#')[0]
    )
  )
  for (const path of paths) {
    const label = diagnostics.networkRequestLabel(path, 'xhr', 'scores-view')
    assert.notEqual(label.diagnosticEndpoint, 'other-local', path)
    assert.deepEqual(
      diagnostics.rendererReceipt({ failed: [{ ...label, status: 0 }] }),
      diagnostics.rendererReceipt({
        failed: [
          { ...diagnostics.requestLabel(path, 'xhr', 'scores-view'), status: 0 }
        ]
      })
    )
  }
})
