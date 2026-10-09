import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import diagnostics from '../../../apps/desktop/platform/macos/request-diagnostics.cjs'

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
