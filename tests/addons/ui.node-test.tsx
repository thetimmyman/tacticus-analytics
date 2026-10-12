import assert from 'node:assert/strict'
import React from 'react'
import test, { type TestContext } from 'node:test'
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

function setupWarManager(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'addon-zone-ui-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    host = new AddonHost(root, fixture.policy),
    commands = createAddonCommands(host)
  const staged = host.stage(fixture.bundle('guild-war'))
  host.activate(staged.digest, staged.manifest.capabilities)
  const binding = {
    accountHandle: 'synthetic-zone-account',
    guildHandle: 'synthetic-zone-guild'
  }
  host.setBinding(binding)
  const ui = render(
    <AddonManager commands={commands} bindingRevision="zone-first" />
  )
  return { host, commands, binding, ui }
}

const zoneReport = {
  ...war,
  battles: [
    { ...war.battles[0]!, zone: 7 },
    { ...war.battles[1]!, zone: 2 },
    { ...war.battles[0]!, battle: 3, zone: 7, points: 30 }
  ]
}

function importWarFile(ui: ReturnType<typeof render>, report: unknown) {
  const file = new window.File(
    [JSON.stringify(report)],
    'synthetic-zone-report.json',
    { type: 'application/json' }
  )
  fireEvent.change(ui.getByLabelText('Import war summary JSON'), {
    target: { files: [file] }
  })
}

function tableCells(table: HTMLElement) {
  return Array.from(table.querySelectorAll('tr'), (row) =>
    Array.from(row.querySelectorAll('th,td'), (cell) => cell.textContent)
  )
}

test('imported local war zones show ordered exact totals alongside unchanged player totals and survive rejected imports', async (t) => {
  const { ui, commands } = setupWarManager(t)
  await waitFor(() => assert.ok(ui.getByLabelText('Import war summary JSON')))
  importWarFile(ui, zoneReport)
  await waitFor(() =>
    assert.ok(ui.getByRole('heading', { level: 3, name: 'Zone totals' }))
  )
  const zones = ui.getByRole('table', { name: 'Zone totals' })
  assert.deepEqual(tableCells(zones), [
    ['Zone', 'Battles', 'Points'],
    ['2', '1', '20'],
    ['7', '2', '280']
  ])
  const players = ui.getByRole('table', { name: '' })
  assert.deepEqual(tableCells(players), [
    ['Player slot', 'Battles', 'Victories', 'Points'],
    ['1', '2', '2', '280'],
    ['2', '1', '0', '20']
  ])
  assert.ok(ui.getByText('Season 1: 3 battles, 300 points.'))
  assert.ok(ui.getByRole('heading', { name: 'Local war report — unverified' }))
  const before = await commands.view('guild-war')
  importWarFile(ui, { ...zoneReport, script: 'synthetic-rejected-content' })
  await waitFor(() => assert.ok(ui.getByRole('alert')))
  assert.equal(
    ui.container.textContent?.includes('synthetic-rejected-content'),
    false
  )
  assert.deepEqual(tableCells(ui.getByRole('table', { name: 'Zone totals' })), [
    ['Zone', 'Battles', 'Points'],
    ['2', '1', '20'],
    ['7', '2', '280']
  ])
  assert.deepEqual(await commands.view('guild-war'), before)
})

test('an empty supported war import replaces old zone totals with an explicit empty state', async (t) => {
  const { ui, commands } = setupWarManager(t)
  await waitFor(() => assert.ok(ui.getByLabelText('Import war summary JSON')))
  importWarFile(ui, zoneReport)
  await waitFor(() => assert.ok(ui.getByRole('table', { name: 'Zone totals' })))
  importWarFile(ui, { ...war, battles: [] })
  await waitFor(() =>
    assert.ok(ui.getByText('No zone activity in this imported report.'))
  )
  assert.ok(ui.getByRole('heading', { level: 3, name: 'Zone totals' }))
  assert.equal(ui.queryByRole('table', { name: 'Zone totals' }), null)
  assert.ok(ui.getByText('Season 1: 0 battles, 0 points.'))
  assert.deepEqual(await commands.view('guild-war'), {
    addonId: 'guild-war',
    report: {
      provenance: 'locally-supplied-unverified',
      season: 1,
      battles: 0,
      points: 0,
      players: [],
      zones: []
    }
  })
})

test('an import-only module cannot expose zone totals or retained data without offline read permission', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'addon-zone-permission-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    host = new AddonHost(root, fixture.policy),
    commands = createAddonCommands(host)
  const staged = host.stage(
    fixture.bundle('guild-war', '1.0.0', {
      capabilities: ['offline.import']
    })
  )
  host.activate(staged.digest, staged.manifest.capabilities)
  host.setBinding({
    accountHandle: 'synthetic-zone-account',
    guildHandle: 'synthetic-zone-guild'
  })
  const ui = render(
    <AddonManager commands={commands} bindingRevision="import-only" />
  )
  await waitFor(() => assert.ok(ui.getByLabelText('Import war summary JSON')))
  importWarFile(ui, zoneReport)
  await waitFor(() =>
    assert.equal(
      (ui.getByLabelText('Import war summary JSON') as HTMLInputElement)
        .disabled,
      false
    )
  )
  assert.equal(
    (
      ui.getByRole('button', {
        name: 'Open retained local data'
      }) as HTMLButtonElement
    ).disabled,
    true
  )
  assert.equal(ui.queryByRole('heading', { name: 'Zone totals' }), null)
  assert.equal(ui.queryByRole('table', { name: 'Zone totals' }), null)
  await assert.rejects(commands.view('guild-war'), /invalid-session/)
})

test('disable and changed guild binding hide zone totals while returning to the original binding preserves saved zones', async (t) => {
  const { ui, commands, host, binding } = setupWarManager(t)
  await waitFor(() => assert.ok(ui.getByLabelText('Import war summary JSON')))
  importWarFile(ui, zoneReport)
  await waitFor(() => assert.ok(ui.getByRole('table', { name: 'Zone totals' })))
  fireEvent.click(ui.getByRole('button', { name: 'Disable' }))
  await waitFor(() => assert.ok(ui.getByRole('button', { name: 'Enable' })))
  assert.equal(ui.queryByRole('heading', { name: 'Zone totals' }), null)
  assert.equal(ui.queryByRole('table', { name: 'Zone totals' }), null)
  fireEvent.click(ui.getByRole('button', { name: 'Enable' }))
  await waitFor(() => assert.ok(ui.getByRole('button', { name: 'Disable' })))
  fireEvent.click(ui.getByRole('button', { name: 'Open retained local data' }))
  await waitFor(() => assert.ok(ui.getByRole('table', { name: 'Zone totals' })))
  await act(async () => {
    host.setBinding({ ...binding, guildHandle: 'synthetic-other-zone-guild' })
    ui.rerender(
      <AddonManager commands={commands} bindingRevision="zone-second" />
    )
  })
  assert.equal(ui.queryByRole('heading', { name: 'Zone totals' }), null)
  assert.equal(ui.queryByRole('table', { name: 'Zone totals' }), null)
  fireEvent.click(ui.getByRole('button', { name: 'Open retained local data' }))
  await waitFor(() => assert.ok(ui.getByRole('alert')))
  assert.equal(ui.queryByRole('table', { name: 'Zone totals' }), null)
  await act(async () => {
    host.setBinding(binding)
    ui.rerender(
      <AddonManager commands={commands} bindingRevision="zone-returned" />
    )
  })
  fireEvent.click(ui.getByRole('button', { name: 'Open retained local data' }))
  await waitFor(() => assert.ok(ui.getByRole('table', { name: 'Zone totals' })))
  assert.deepEqual(tableCells(ui.getByRole('table', { name: 'Zone totals' })), [
    ['Zone', 'Battles', 'Points'],
    ['2', '1', '20'],
    ['7', '2', '280']
  ])
})

for (const id of ['guild-war', 'replays'] as const) {
  test(`explicit ${id} export uses trusted read-only save callback and retains other module data`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'addon-export-ui-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const fixture = fixturePolicy(),
      host = new AddonHost(root, fixture.policy)
    host.setBinding({
      accountHandle: 'synthetic-export-account',
      guildHandle: 'synthetic-export-guild'
    })
    const saved: { id: string; json: string }[] = []
    const commands = createAddonCommands(host, async (selected, read) => {
      saved.push({ id: selected, json: read() })
    })
    for (const moduleId of ['guild-war', 'replays'] as const) {
      const staged = host.stage(fixture.bundle(moduleId))
      host.activate(staged.digest, staged.manifest.capabilities)
      await commands.importLocalData(
        moduleId,
        JSON.stringify(moduleId === 'guild-war' ? war : replay)
      )
    }
    const other = await commands.view(
      id === 'guild-war' ? 'replays' : 'guild-war'
    )
    const ui = render(
      <AddonManager commands={commands} bindingRevision="export-current" />
    )
    const name =
      id === 'guild-war'
        ? 'Export war summary JSON'
        : 'Export replay timeline JSON'
    await waitFor(() => assert.ok(ui.getByRole('button', { name })))
    fireEvent.click(ui.getByRole('button', { name }))
    await waitFor(() => assert.equal(saved.length, 1))
    assert.equal(saved[0]!.id, id)
    assert.deepEqual(
      JSON.parse(saved[0]!.json),
      id === 'guild-war' ? war : replay
    )
    assert.deepEqual(
      await commands.view(id === 'guild-war' ? 'replays' : 'guild-war'),
      other
    )
    await waitFor(() =>
      assert.equal(
        (ui.getByRole('button', { name }) as HTMLButtonElement).disabled,
        false
      )
    )
    assert.equal(ui.queryByRole('alert'), null)
  })
}

test('export UI refuses missing data and changed binding, disables unreadable or disabled modules and hides raw failures', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'addon-export-gates-ui-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    host = new AddonHost(root, fixture.policy)
  const binding = {
    accountHandle: 'synthetic-export-account',
    guildHandle: 'synthetic-export-guild'
  }
  host.setBinding(binding)
  let saves = 0
  const commands = createAddonCommands(host, async () => {
    saves += 1
  })
  for (const id of ['guild-war', 'replays'] as const) {
    const staged = host.stage(
      fixture.bundle(
        id,
        '1.0.0',
        id === 'replays' ? { capabilities: ['offline.import'] } : {}
      )
    )
    host.activate(staged.digest, staged.manifest.capabilities)
  }
  const ui = render(
    <AddonManager commands={commands} bindingRevision="export-first" />
  )
  await waitFor(() =>
    assert.ok(ui.getByRole('button', { name: 'Export war summary JSON' }))
  )
  assert.equal(
    (
      ui.getByRole('button', {
        name: 'Export replay timeline JSON'
      }) as HTMLButtonElement
    ).disabled,
    true
  )
  fireEvent.click(ui.getByRole('button', { name: 'Export war summary JSON' }))
  await waitFor(() =>
    assert.match(ui.getByRole('alert').textContent!, /No imported data/)
  )
  assert.equal(saves, 0)
  await commands.importLocalData('guild-war', JSON.stringify(war))
  await act(async () => {
    host.setBinding({ ...binding, guildHandle: 'synthetic-other-export-guild' })
    ui.rerender(
      <AddonManager commands={commands} bindingRevision="export-second" />
    )
  })
  fireEvent.click(ui.getByRole('button', { name: 'Export war summary JSON' }))
  await waitFor(() =>
    assert.match(ui.getByRole('alert').textContent!, /No imported data/)
  )
  assert.equal(saves, 0)
  await act(async () => {
    await commands.setEnabled('guild-war', false)
    ui.rerender(
      <AddonManager commands={commands} bindingRevision="export-disabled" />
    )
  })
  await waitFor(() =>
    assert.equal(
      (
        ui.getByRole('button', {
          name: 'Export war summary JSON'
        }) as HTMLButtonElement
      ).disabled,
      true
    )
  )
})
