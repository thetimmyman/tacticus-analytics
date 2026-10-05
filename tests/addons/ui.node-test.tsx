import assert from 'node:assert/strict'
import React from 'react'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { AddonManager } from '../../apps/addons/AddonManager'
import { createAddonCommands } from '../../apps/addons/commands'
import { actionMessage } from '../../apps/addons/messages'
import { AddonHost } from '../../packages/addon-host/src/host'
import { fixturePolicy, replay, war } from './fixtures'

const window = new Window()
let fireEvent: (typeof import('@testing-library/react'))['fireEvent']
let render: (typeof import('@testing-library/react'))['render']
let waitFor: (typeof import('@testing-library/react'))['waitFor']
let cleanup: (typeof import('@testing-library/react'))['cleanup']
let act: (typeof import('@testing-library/react'))['act']
Object.defineProperties(globalThis, {
  window: { value: window, configurable: true },
  document: { value: window.document, configurable: true },
  navigator: { value: window.navigator, configurable: true },
  HTMLElement: { value: window.HTMLElement, configurable: true },
  MutationObserver: { value: window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true }
})
test.before(async () => {
  const testing = await import('@testing-library/react')
  fireEvent = testing.fireEvent
  render = testing.render
  waitFor = testing.waitFor
  cleanup = testing.cleanup
  act = testing.act
})
test.afterEach(() => cleanup())

test('graphical signed install, local war report, disable and explicit uninstall retention use real host commands', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'addon-ui-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    host = new AddonHost(root, fixture.policy),
    commands = createAddonCommands(host)
  host.setBinding({
    accountHandle: 'synthetic-account',
    guildHandle: 'synthetic-guild'
  })
  const ui = render(
    <AddonManager commands={commands} bindingRevision="first" />
  )
  await waitFor(() => assert.ok(ui.queryByRole('alert') === null))
  const packageFile = new window.File(
    [JSON.stringify(fixture.bundle('guild-war'))],
    'synthetic-package.json',
    { type: 'application/json' }
  )
  fireEvent.change(ui.getByLabelText('Choose signed package'), {
    target: { files: [packageFile] }
  })
  await waitFor(() =>
    assert.ok(ui.getByRole('button', { name: 'Approve and install' }))
  )
  assert.equal(host.list().length, 0)
  fireEvent.click(ui.getByRole('button', { name: 'Approve and install' }))
  await waitFor(() => assert.ok(ui.getByRole('button', { name: 'Disable' })))
  const dataFile = new window.File(
    [JSON.stringify(war)],
    'synthetic-war.json',
    { type: 'application/json' }
  )
  fireEvent.change(ui.getByLabelText('Import war summary JSON'), {
    target: { files: [dataFile] }
  })
  await waitFor(() =>
    assert.ok(ui.getByText('Season 1: 2 battles, 270 points.'))
  )
  fireEvent.click(ui.getByRole('button', { name: 'Disable' }))
  await waitFor(() => assert.ok(ui.getByRole('button', { name: 'Enable' })))
  assert.ok(ui.queryByText('Season 1: 2 battles, 270 points.') === null)
  fireEvent.click(
    ui.getByRole('button', { name: 'Uninstall and retain module data' })
  )
  await waitFor(() => {
    assert.equal(host.list().length, 0)
    assert.ok(ui.queryByRole('button', { name: 'Enable' }) === null)
  })
  const staged = host.stage(fixture.bundle('guild-war'))
  host.activate(staged.digest, staged.manifest.capabilities)
  assert.deepEqual(host.readData(host.openSession('guild-war')), war)
})

test('graphical replay seek and binding change clear old module views', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'addon-ui-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    host = new AddonHost(root, fixture.policy),
    commands = createAddonCommands(host)
  const staged = host.stage(fixture.bundle('replays'))
  host.activate(staged.digest, staged.manifest.capabilities)
  host.setBinding({ accountHandle: 'synthetic-account', guildHandle: null })
  host.importData(host.openSession('replays'), JSON.stringify(replay))
  const ui = render(
    <AddonManager commands={commands} bindingRevision="first" />
  )
  await waitFor(() =>
    assert.ok(ui.getByRole('button', { name: 'Open retained local data' }))
  )
  fireEvent.click(ui.getByRole('button', { name: 'Open retained local data' }))
  await waitFor(() =>
    assert.ok(ui.getByRole('slider', { name: 'Playback position' }))
  )
  fireEvent.change(ui.getByRole('slider', { name: 'Playback position' }), {
    target: { value: '500' }
  })
  assert.ok(ui.getByText('● 1 (70)'))
  host.setBinding({
    accountHandle: 'synthetic-other-account',
    guildHandle: null
  })
  await act(async () => {
    ui.rerender(<AddonManager commands={commands} bindingRevision="second" />)
    await commands.list()
  })
  assert.ok(ui.queryByRole('slider') === null)
  assert.ok(ui.queryByText('● 1 (70)') === null)
})

test('UI failures use fixed safe messages for serialized native errors and hostile payloads', () => {
  assert.match(
    actionMessage({
      code: 'untrusted-package',
      message: 'synthetic-forbidden-canary'
    }),
    /not approved/
  )
  assert.equal(
    actionMessage({ code: 'synthetic-forbidden-canary' }).includes(
      'synthetic-forbidden-canary'
    ),
    false
  )
})
