import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

function ordinaryMain(mode) {
  const directory = mkdtempSync(join(tmpdir(), 'mac-addon-menu-'))
  try {
    const config = join(directory, 'config.json')
    const resultPath = join(directory, 'result.json')
    const facade = join(directory, 'electron-facade.cjs')
    writeFileSync(
      config,
      JSON.stringify({
        url: 'http://127.0.0.1:34567/desktop/personal',
        brokerToken: 'a'.repeat(64),
        transportKey: 'b'.repeat(64),
        state: directory,
        verify: false
      })
    )
    writeFileSync(
      facade,
      `
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { writeFileSync } = require('node:fs')
const Module = require('node:module')
const mode = process.env.SYNTHETIC_ADDON_MODE
const result = { events: [], menu: null, calls: 0, errors: [], sandbox: false }
let owner
class BrowserWindow extends EventEmitter {
  constructor(options) {
    super(); owner=this; result.preferences=options.webPreferences
    this.webContents=Object.assign(new EventEmitter(), { session:{ cookies:{get:async()=>[]} }, setWindowOpenHandler(){} })
  }
  isDestroyed(){return false}
  async loadURL(){result.events.push('load')}
}
const app = new EventEmitter()
Object.assign(app, { commandLine:{appendSwitch(){}}, enableSandbox(){result.sandbox=true}, disableHardwareAcceleration(){}, setPath(){}, whenReady:async()=>{}, quit(){}, exit(){result.errors.push('main-exit')} })
const webRequest=Object.fromEntries(['onBeforeRequest','onBeforeSendHeaders','onCompleted','onErrorOccurred'].map(name=>[name,()=>{}]))
const electron={ app, BrowserWindow, session:{defaultSession:{setPermissionRequestHandler(){},webRequest}}, Menu:{buildFromTemplate:items=>items,setApplicationMenu(items){result.menu=items;result.events.push('menu')}},dialog:{showMessageBox:async()=>({})} }
const load=Module._load
Module._load=function(name,parent,...args){
  if(name==='electron')return electron
  if(name==='./device-session.cjs'&&parent.filename.endsWith('/platform/macos/main.cjs'))return ()=>({open:async()=>{result.events.push('device-open');return true}})
  if(name==='../../launcher/addon-menu.cjs')return async(window,config)=>{
    assert.equal(window,owner);assert.equal(config.verify,false);assert.equal(config.transportKey,'b'.repeat(64));assert.equal(config.brokerToken,'a'.repeat(64));result.calls++;result.events.push('addon-create')
    if(mode==='damaged')throw new Error('synthetic-private-policy-canary')
    return { id:'application-addons',label:'Local add-ons…',click:()=>{result.events.push('addon-click')} }
  }
  return load.call(this,name,parent,...args)
}
process.once('beforeExit',()=>{
  const workspace=result.menu?.find(item=>item.label==='Workspace')
  const addon=workspace?.submenu.find(item=>item.id==='application-addons')
  if(addon)addon.click()
  result.menu=JSON.parse(JSON.stringify(result.menu))
  writeFileSync(process.env.SYNTHETIC_ADDON_RESULT,JSON.stringify(result))
})
`
    )
    const run = spawnSync(
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
        env: {
          ...process.env,
          SYNTHETIC_ADDON_MODE: mode,
          SYNTHETIC_ADDON_RESULT: resultPath
        },
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 65536
      }
    )
    assert.equal(run.error, undefined)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.signal, null)
    return JSON.parse(readFileSync(resultPath, 'utf8'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('ordinary macOS Workspace menu opens the shared native add-on manager without another device login', () => {
  const result = ordinaryMain('ready')
  const workspace = result.menu.find((item) => item.label === 'Workspace')
  assert.equal(result.calls, 1)
  assert.equal(
    workspace.submenu.find((item) => item.id === 'application-addons').label,
    'Local add-ons…'
  )
  assert.equal(result.events.filter((item) => item === 'device-open').length, 1)
  assert.equal(result.events.filter((item) => item === 'addon-click').length, 1)
  assert.equal(result.events.includes('load'), false)
  assert.equal(result.sandbox, true)
  assert.equal(result.preferences.sandbox, true)
  assert.equal(result.preferences.contextIsolation, true)
  assert.equal(result.preferences.nodeIntegration, false)
  assert.deepEqual(result.errors, [])
})

test('damaged add-on initialization leaves ordinary recovery and official access menus usable with a fixed disabled item', () => {
  const result = ordinaryMain('damaged')
  const workspace = result.menu.find((item) => item.label === 'Workspace')
  assert.equal(result.calls, 1)
  assert.deepEqual(workspace.submenu.at(-1), {
    label: 'Local add-ons unavailable',
    enabled: false
  })
  assert(
    workspace.submenu.some(
      (item) => item.label === 'Recover retained personal data…'
    )
  )
  assert(
    workspace.submenu.some(
      (item) => item.label === 'Import cached personal data…'
    )
  )
  assert(
    workspace.submenu.some(
      (item) => item.label === 'Export cached personal data…'
    )
  )
  assert(result.menu.some((item) => item.label === 'Official access'))
  assert.equal(result.events.filter((item) => item === 'device-open').length, 1)
  assert.equal(
    JSON.stringify(result).includes('synthetic-private-policy-canary'),
    false
  )
  assert.deepEqual(result.errors, [])
})
