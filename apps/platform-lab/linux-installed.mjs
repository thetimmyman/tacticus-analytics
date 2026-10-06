import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { runOwnedProcess } from './process.mjs'
import { checkWorkspace } from './workspace.mjs'
import { generateFixture } from './fixtures.mjs'

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}
export function buildOfflineCommand({
  runtimeRoot,
  state,
  verify,
  launchArgs,
  uid,
  gid
}) {
  if (
    !Number.isSafeInteger(uid) ||
    uid < 1 ||
    !Number.isSafeInteger(gid) ||
    gid < 1
  )
    throw new Error('An unprivileged Linux user is required')
  const node = join(runtimeRoot, 'bin/node')
  const probe =
    'const n=require("node:os").networkInterfaces();if(Object.keys(n).some(k=>k!=="lo"))process.exit(2)'
  const inner = `${[node, '-e', probe].map(quote).join(' ')} && exec ${[
    join(runtimeRoot, 'launch'),
    ...(launchArgs ?? ['--state', state, '--verify', verify])
  ]
    .map(quote)
    .join(' ')}`
  return [
    '-rn',
    '--',
    'sh',
    '-c',
    `ip link set lo up && exec ${['unshare', `--map-user=${uid}`, `--map-group=${gid}`, '--', 'sh', '-c', inner].map(quote).join(' ')}`
  ]
}
export function createAdapter({ runtimeRoot, displayEnvironment = {} }) {
  if (
    process.platform !== 'linux' ||
    typeof runtimeRoot !== 'string' ||
    resolve(runtimeRoot) !== runtimeRoot
  )
    throw new Error('Explicit installed Linux runtime directory required')
  const displayKeys = [
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'DISPLAY',
    'XAUTHORITY',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_CURRENT_DESKTOP'
  ]
  if (
    !displayEnvironment ||
    typeof displayEnvironment !== 'object' ||
    Array.isArray(displayEnvironment) ||
    Object.entries(displayEnvironment).some(
      ([key, value]) =>
        !displayKeys.includes(key) ||
        typeof value !== 'string' ||
        !value.length ||
        value.length > 1024
    )
  )
    throw new Error('Explicit bounded graphical display configuration required')
  return {
    schemaVersion: 'platform-adapter/v1',
    supportedScenarios: [
      'offline-core',
      'restart-persistence',
      'backup-restore'
    ],
    async run({ scenario, fixture, workspace }) {
      await checkWorkspace(workspace)
      if (fixture.network.mode !== 'deny')
        return {
          status: 'blocked',
          actual: 'The Linux regression adapter requires deny mode.',
          blockers: ['Kernel-isolated deny-mode plan required.'],
          assertions: [],
          captures: []
        }
      if (!displayEnvironment.WAYLAND_DISPLAY && !displayEnvironment.DISPLAY)
        return {
          status: 'blocked',
          actual: 'No graphical desktop session is available.',
          blockers: ['Wayland or X11 graphical session required.'],
          assertions: [],
          captures: []
        }
      if (
        JSON.stringify(fixture.profile) !==
        JSON.stringify(generateFixture(fixture.seed, 'deny').profile)
      )
        return {
          status: 'blocked',
          actual:
            'The installed preview carries its own synthetic data and cannot load this fixture profile.',
          blockers: ['Fixture profile must match the preview built-in data.'],
          assertions: [],
          captures: []
        }
      await access(join(runtimeRoot, 'launch'))
      const state = join(workspace, 'state', 'installed-regression')
      const passwordFile = join(workspace, 'fixtures', 'regression-password')
      let password
      try {
        password = await readFile(passwordFile, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        password = randomBytes(24).toString('hex')
        await writeFile(passwordFile, password, { mode: 0o600, flag: 'wx' })
      }
      async function launch(target, expectedMode) {
        const id = randomUUID()
        const evidence = join(
          workspace,
          'captures',
          `${id}-renderer-private.json`
        )
        const verify = join(workspace, 'fixtures', `${id}-verify.json`)
        await writeFile(
          verify,
          JSON.stringify({
            password,
            evidence,
            screenshot: join(workspace, 'captures', `${id}-private.png`)
          }),
          { mode: 0o600, flag: 'wx' }
        )
        const result = await runOwnedProcess(
          'unshare',
          buildOfflineCommand({
            runtimeRoot,
            state: target,
            verify,
            uid: process.getuid(),
            gid: process.getgid()
          }),
          { timeoutMs: 120000, env: { ...process.env, ...displayEnvironment } }
        )
        await writeFile(
          join(workspace, 'captures', `${id}-process-private.log`),
          result.output,
          { mode: 0o600, flag: 'wx' }
        )
        if (result.code !== 0 || result.timedOut || result.exceeded)
          throw new Error(
            'Installed preview regression failed; private diagnostics retained'
          )
        const observed = JSON.parse(await readFile(evidence, 'utf8'))
        if (observed.setupMode !== expectedMode)
          throw new Error(
            'Installed preview did not report the expected setup state'
          )
        if (
          observed.observed?.nodeAccess !== false ||
          !observed.observed?.text.includes('+58%') ||
          !observed.observed?.text.includes('-50%') ||
          observed.sandbox !== true ||
          observed.contextIsolation !== true ||
          observed.nodeIntegration !== false
        )
          throw new Error('Installed preview assertions failed')
        return {
          setupMode: observed.setupMode,
          scoresRendered: true,
          rendererSandboxed: true,
          onlyLoopbackInterface: true
        }
      }
      const first = await launch(state, 'create')
      let extra
      if (scenario === 'restart-persistence')
        extra = await launch(state, 'unlock')
      if (scenario === 'backup-restore') {
        const backup = join(workspace, 'snapshots', `backup-${randomUUID()}`)
        const restored = join(workspace, 'state', 'restored')
        for (const launchArgs of [
          ['--state', state, '--backup', backup],
          ['--state', restored, '--restore', backup]
        ]) {
          const result = await runOwnedProcess(
            'unshare',
            buildOfflineCommand({
              runtimeRoot,
              launchArgs,
              uid: process.getuid(),
              gid: process.getgid()
            }),
            { timeoutMs: 60000, env: { ...process.env, ...displayEnvironment } }
          )
          if (result.code !== 0 || result.timedOut || result.exceeded)
            throw new Error('Installed preview transfer failed')
        }
        extra = await launch(restored, 'unlock')
      }
      return {
        status: 'pass',
        actual:
          'The existing installed preview passed its selected synthetic calculation slice in a loopback-only kernel network namespace. Full product parity and clean-machine installation remain unqualified.',
        blockers: [],
        assertions: [
          {
            id: 'installed-offline-slice',
            status: 'pass',
            expected:
              'Installed preview opens synthetic data and renders expected calculation results offline.',
            actual:
              'Synthetic +58% and -50% results rendered; Node integration disabled and renderer sandbox enabled.'
          },
          ...(extra
            ? [
                {
                  id: scenario,
                  status: 'pass',
                  expected:
                    scenario === 'backup-restore'
                      ? 'Stopped-state restored data renders the same synthetic results.'
                      : 'Ordinary restart retains synthetic calculation data.',
                  actual:
                    'The installed preview reported an existing state (unlock rather than first-run create) and rendered the same synthetic calculation results.'
                }
              ]
            : [])
        ],
        captures: [
          {
            name: 'regression-summary.json',
            mediaType: 'application/json',
            text: JSON.stringify({
              first,
              repeatedOrRestored: extra ?? null,
              scope: 'selected-synthetic-preview-slice',
              canaryIntegration: 'not-exercised'
            })
          }
        ]
      }
    }
  }
}
