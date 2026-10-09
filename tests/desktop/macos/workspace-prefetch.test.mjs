import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Exercise the real production App Router Link, rather than the shared test Link mock.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const requireActual = createRequire(resolve(sourceRoot, 'package.json'))
const { Window } = await import(
  pathToFileURL(requireActual.resolve('happy-dom')).href
)
const window = new Window({
  url: 'http://localhost:3000/player-performance?season=9999'
})
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'FocusEvent'
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? window : window[key]
  })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const originalTimers = new Map()
for (const key of [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval'
]) {
  originalTimers.set(key, globalThis[key])
  globalThis[key] = window[key].bind(window)
}
const observed = new Set()
class BoundaryObserver {
  observe(element) {
    observed.add(element)
  }
  unobserve(element) {
    observed.delete(element)
  }
  disconnect() {
    observed.clear()
  }
}
globalThis.IntersectionObserver = BoundaryObserver
let fetches = 0
globalThis.fetch = window.fetch = () => {
  fetches++
  throw new Error('Host boundary forbids network')
}
// Match the pinned Next browser compiler alias; this is the genuine compiled client, not a stub.
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (id, ...args) {
  if (id === 'react-server-dom-webpack/client')
    return requireActual.resolve(
      'next/dist/compiled/react-server-dom-webpack/client.browser'
    )
  return originalResolve.call(this, id, ...args)
}
let chunkLoads = 0
const refuseChunk = () => {
  chunkLoads++
  throw new Error('Host boundary forbids chunk loading')
}
globalThis.__webpack_require__ = Object.assign(refuseChunk, { u: refuseChunk })
globalThis.__webpack_chunk_load__ = refuseChunk
const React = requireActual('react')
const { createRoot } = requireActual('react-dom/client')
const { AppRouterContext } = requireActual(
  'next/dist/shared/lib/app-router-context.shared-runtime'
)
const { PathnameContext, SearchParamsContext } = requireActual(
  'next/dist/shared/lib/hooks-client-context.shared-runtime'
)
const ts = requireActual('typescript')
const cache = new Map()
let downloadsState = { status: 'ready', releases: [{ component: 'core' }] }
let dataReads = 0
function sourceFile(file) {
  if (existsSync(file) && extname(file)) return file
  for (const suffix of ['.ts', '.tsx', '.json', '/index.ts', '/index.tsx'])
    if (existsSync(file + suffix)) return file + suffix
  throw new Error('Missing source module')
}
function load(file) {
  file = sourceFile(resolve(file))
  if (cache.has(file)) return cache.get(file).exports
  if (extname(file) === '.json') return JSON.parse(readFileSync(file, 'utf8'))
  const mod = new Module(file)
  cache.set(file, mod)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(sourceRoot)
  mod.require = (id) => {
    if (id === 'next/link')
      return requireActual('next/dist/client/app-dir/link')
    // The server read is the inert data boundary, never a substituted Link or chrome component.
    if (id === '@/app/lib/downloads/server')
      return { getDownloadsState: async () => downloadsState }
    if (id === '@/app/lib/db/client')
      return {
        dbClient: () => ({
          rpc: () => {
            dataReads++
            throw new Error('Host boundary forbids data reads')
          }
        })
      }
    if (id.startsWith('@/')) return load(sourceRoot + '/' + id.slice(2))
    if (id === '@tacticus/ui-kit' || id.startsWith('@tacticus/ui-kit/'))
      return load(
        sourceRoot +
          '/packages/ui-kit/src/' +
          (id === '@tacticus/ui-kit'
            ? 'index'
            : id.slice('@tacticus/ui-kit/'.length))
      )
    if (id.startsWith('@tacticus/app-core/'))
      return load(
        sourceRoot +
          '/packages/app-core/src/' +
          id.slice('@tacticus/app-core/'.length) +
          ''
      )
    if (id.startsWith('.')) return load(resolve(dirname(file), id))
    return requireActual(id)
  }
  const built = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: file
  })
  mod._compile(built.outputText, file)
  return mod.exports
}
const componentFile = resolve(
  sourceRoot,
  'app/components/navigation/WorkspaceBar.tsx'
)
const { WorkspaceBar } = load(componentFile)
const { SectionSubnav } = load(
  resolve(sourceRoot, 'app/components/navigation/SectionSubnav.tsx')
)
async function rendered(
  profile,
  props,
  check,
  { Component = WorkspaceBar, pathname = '/player-performance' } = {}
) {
  const previous = process.env.NEXT_PUBLIC_RUNTIME_PROFILE
  if (profile === undefined) delete process.env.NEXT_PUBLIC_RUNTIME_PROFILE
  else process.env.NEXT_PUBLIC_RUNTIME_PROFILE = profile
  observed.clear()
  fetches = 0
  dataReads = 0
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let previews = []
  try {
    await React.act(async () =>
      root.render(
        React.createElement(
          AppRouterContext.Provider,
          { value: {} },
          React.createElement(
            PathnameContext.Provider,
            { value: pathname },
            React.createElement(
              SearchParamsContext.Provider,
              { value: new URLSearchParams('season=9999') },
              React.createElement(Component, {
                effectiveRole: 'officer',
                hasProfile: true,
                onPreviewWorkspace: (value) => previews.push(value),
                ...props
              })
            )
          )
        )
      )
    )
    await check(host, previews)
    assert.equal(fetches, 0, 'inert host control must never use network')
    assert.equal(dataReads, 0, 'chrome policy test must never read member data')
    assert.equal(
      chunkLoads,
      0,
      'inert host control must never load browser chunks'
    )
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
    if (previous === undefined) delete process.env.NEXT_PUBLIC_RUNTIME_PROFILE
    else process.env.NEXT_PUBLIC_RUNTIME_PROFILE = previous
  }
}
function raid(host) {
  return [...host.querySelectorAll('a')].find(
    (a) => a.textContent.trim() === 'Raid'
  )
}
function observedRaid() {
  return [...observed].some(
    (a) => a.getAttribute('href') === '/dashboard?season=9999'
  )
}

test('desktop actual Next Link does not register speculative dashboard work', async () => {
  await rendered('desktop', {}, async (host) => {
    assert.equal(raid(host)?.getAttribute('href'), '/dashboard?season=9999')
    assert.equal(observedRaid(), false)
    assert.equal(observed.size, 0)
  })
})
test('hosted retains actual Next Link default prefetch registration', async () => {
  await rendered('hosted', {}, async (host) => {
    assert.equal(raid(host)?.getAttribute('href'), '/dashboard?season=9999')
    assert.equal(observedRaid(), true)
    assert.ok(observed.size > 0)
  })
})
test('unset profile retains hosted default registration', async () => {
  await rendered(undefined, {}, async () => assert.equal(observedRaid(), true))
})
test('desktop keeps ordinary href, preview handler, and modified-click default', async () => {
  await rendered('desktop', {}, async (host, previews) => {
    const anchor = raid(host)
    await React.act(async () =>
      anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    )
    assert.deepEqual(previews, ['raid'])
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true
    })
    anchor.dispatchEvent(event)
    assert.equal(event.defaultPrevented, false)
    assert.equal(anchor.getAttribute('href'), '/dashboard?season=9999')
    assert.equal(observedRaid(), false)
  })
})
test('desktop preserves inactive navigation omission', async () => {
  await rendered(
    'desktop',
    { hideAnalytics: true, hasProfile: false },
    async (host) => {
      assert.equal(raid(host), undefined)
      assert.equal(observed.size, 0)
    }
  )
})
test('desktop previewed Raid subnav does not register dashboard prefetch', async () => {
  await rendered(
    'desktop',
    { workspaceId: 'raid' },
    async (host) => {
      assert.equal(
        [...host.querySelectorAll('a')]
          .find((a) => a.textContent.trim() === 'Dashboard')
          ?.getAttribute('href'),
        '/dashboard?season=9999'
      )
      assert.equal(observedRaid(), false)
      assert.equal(observed.size, 0)
    },
    { Component: SectionSubnav }
  )
})
test('hosted previewed Raid subnav keeps default dashboard registration', async () => {
  await rendered(
    'hosted',
    { workspaceId: 'raid' },
    async () => {
      assert.equal(observedRaid(), true)
      assert.ok(observed.size > 0)
    },
    { Component: SectionSubnav }
  )
})
test('desktop active Guild Ops subnav keeps selected-season links without prefetch', async () => {
  await rendered(
    'desktop',
    {},
    async (host) => {
      const link = [...host.querySelectorAll('a')].find(
        (a) => a.textContent.trim() === 'Performance'
      )
      assert.equal(
        link?.getAttribute('href'),
        '/player-performance?season=9999'
      )
      assert.equal(observed.size, 0)
    },
    { Component: SectionSubnav }
  )
})
test('desktop war detail exit remains an explicit link without prefetch', async () => {
  await rendered(
    'desktop',
    {},
    async (host) => {
      const link = host.querySelector('a')
      assert.equal(link?.getAttribute('href'), '/wars?season=9999')
      assert.equal(link?.textContent.includes('All War Tools'), true)
      assert.equal(observed.size, 0)
    },
    { Component: SectionSubnav, pathname: '/wars/synthetic-detail' }
  )
})
test('hosted war detail exit retains default registration', async () => {
  await rendered(
    'hosted',
    {},
    async (host) => {
      assert.equal(
        host.querySelector('a')?.getAttribute('href'),
        '/wars?season=9999'
      )
      assert.equal(observed.size, 1)
    },
    { Component: SectionSubnav, pathname: '/wars/synthetic-detail' }
  )
})
test('external workspace subnav links keep safe external anchor behavior', async () => {
  await rendered(
    'desktop',
    { workspaceId: 'tools' },
    async (host) => {
      const links = [...host.querySelectorAll('a')]
      assert.ok(links.length > 0)
      for (const link of links) {
        assert.equal(link.getAttribute('target'), '_blank')
        assert.equal(link.getAttribute('rel'), 'noopener noreferrer')
        assert.equal(link.hasAttribute('prefetch'), false)
      }
      assert.equal(observed.size, 0)
    },
    { Component: SectionSubnav }
  )
})
test('strict existing request failure oracle keeps ERR_FAILED and recovered 401 fatal', () => {
  const diagnostics = createRequire(sourceRoot + '/package.json')(
    './apps/desktop/platform/macos/request-diagnostics.cjs'
  )
  assert.equal(
    diagnostics.unexpectedFailure({
      path: '/dashboard',
      status: 0,
      phase: 'scores-view',
      errorCategory: 'ERR_FAILED'
    }),
    true
  )
  assert.equal(
    diagnostics.unexpectedFailure({
      path: '/dashboard',
      status: 401,
      phase: 'recovered-open'
    }),
    true
  )
  assert.equal(
    diagnostics.unexpectedFailure({
      path: '/dashboard',
      status: 401,
      phase: 'signed-out-check'
    }),
    false
  )
})

const surfaces = [
  {
    name: 'footer information links',
    file: 'app/components/Footer.tsx',
    exported: 'default',
    props: {},
    href: '/acknowledgements'
  },
  {
    name: 'authenticated chrome brand',
    file: 'app/components/navigation/AlphaChromeBar.tsx',
    exported: 'AlphaChromeBar',
    props: {
      user: { id: 'synthetic' },
      hideAnalytics: true,
      hasProfile: false
    },
    href: '/home'
  },
  {
    name: 'account profile',
    file: 'app/components/navigation/AccountMenuChrome.tsx',
    exported: 'AccountMenuHeader',
    props: {
      currentSeason: '9999',
      guildDisplayLabel: 'Synthetic',
      inactiveNavigation: false,
      user: { id: 'synthetic' },
      variant: 'desktop'
    },
    href: '/profile?season=9999'
  },
  {
    name: 'breadcrumb',
    file: 'app/components/navigation/Breadcrumbs.tsx',
    exported: 'Breadcrumbs',
    props: {
      items: [
        { name: 'Group', href: '/group' },
        { name: 'Current', href: '/current' }
      ]
    },
    href: '/group'
  },
  {
    name: 'mobile chrome brand',
    file: 'app/components/navigation/MobileNav.tsx',
    exported: 'MobileNav',
    props: {
      user: { id: 'synthetic' },
      currentSeason: '9999',
      hideAnalytics: true,
      hasProfile: false,
      onLogout: () => {}
    },
    href: '/home'
  },
  {
    name: 'onboarding navigation',
    file: 'app/components/navigation/OnboardingNav.tsx',
    exported: 'OnboardingNav',
    props: { onLogout: () => {} },
    href: '/onboarding/dashboard'
  },
  {
    name: 'public navigation',
    file: 'app/components/navigation/PublicNav.tsx',
    exported: 'PublicNav',
    props: {},
    href: '/auth/login'
  },
  {
    name: 'account workspace menu',
    file: 'app/components/navigation/WorkspaceSectionMenuLink.tsx',
    exported: 'WorkspaceSectionMenuLink',
    props: {
      currentSeason: '9999',
      pathname: '/player-performance',
      section: { href: '/dashboard', label: 'Dashboard' },
      variant: 'desktop'
    },
    href: '/dashboard?season=9999'
  },
  {
    name: 'page tabs',
    file: 'app/components/navigation/PageTabsSubnav.tsx',
    exported: 'PageTabsSubnav',
    props: {
      tabs: [{ value: 'one', label: 'One', href: '/one?season=9999' }],
      value: 'one'
    },
    href: '/one?season=9999'
  },
  {
    name: 'war rail',
    file: 'app/components/navigation/WarSubnav.tsx',
    exported: 'WarSubnav',
    props: { mode: { kind: 'global' } },
    href: '/wars?season=9999',
    pathname: '/wars'
  },
  {
    name: 'conditional downloads entry',
    file: 'app/downloads/DownloadsNavigationEntry.tsx',
    exported: 'default',
    server: true,
    props: {},
    href: '/downloads'
  }
]
for (const surface of surfaces) {
  for (const profile of ['desktop', 'hosted']) {
    test(`${profile} ${surface.name} preserves href with runtime-specific Next registration`, async () => {
      const Original = load(resolve(sourceRoot, surface.file))[surface.exported]
      const element = surface.server ? await Original() : null
      const Component = surface.server ? () => element : Original
      await rendered(
        profile,
        surface.props,
        async (host) => {
          const anchors = [...host.querySelectorAll('a')]
          assert.ok(
            anchors.some((a) => a.getAttribute('href') === surface.href),
            'ordinary navigation must remain present'
          )
          const registered = [...observed].filter(
            (a) => a.getAttribute('href') === surface.href
          )
          assert.equal(registered.length > 0, profile === 'hosted')
          if (profile === 'desktop') {
            const anchor = anchors.find(
              (a) => a.getAttribute('href') === surface.href
            )
            await React.act(async () => {
              anchor.dispatchEvent(
                new MouseEvent('mouseover', { bubbles: true })
              )
              anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
            })
            const click = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              ctrlKey: true
            })
            anchor.dispatchEvent(click)
            assert.equal(click.defaultPrevented, false)
            assert.equal(anchor.getAttribute('href'), surface.href)
            assert.equal(observed.size, 0)
          }
        },
        { Component, pathname: surface.pathname }
      )
    })
  }
}

test('shared chrome Link forwards ref, focus, click and Radix injected anchor props', async () => {
  const { ChromeLink } = load(
    resolve(sourceRoot, 'app/components/navigation/ChromeLink.tsx')
  )
  const ref = React.createRef()
  let focuses = 0
  let clicks = 0
  await rendered(
    'desktop',
    {
      href: '/profile?season=9999',
      ref,
      role: 'menuitem',
      'data-state': 'checked',
      onFocus: () => focuses++,
      onClick: () => clicks++,
      children: 'Profile'
    },
    async (host) => {
      const anchor = host.querySelector('a')
      assert.equal(ref.current, anchor)
      assert.equal(anchor.getAttribute('role'), 'menuitem')
      assert.equal(anchor.getAttribute('data-state'), 'checked')
      await React.act(async () =>
        anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      )
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true
      })
      anchor.dispatchEvent(event)
      assert.equal(focuses, 1)
      assert.equal(clicks, 1)
      assert.equal(event.defaultPrevented, false)
      assert.equal(observed.size, 0)
    },
    { Component: ChromeLink }
  )
})
test('hosted chrome preserves explicit prefetch false and unset profile default', async () => {
  const { ChromeLink } = load(
    resolve(sourceRoot, 'app/components/navigation/ChromeLink.tsx')
  )
  await rendered(
    'hosted',
    { href: '/profile', prefetch: false, children: 'Profile' },
    async () => assert.equal(observed.size, 0),
    { Component: ChromeLink }
  )
  await rendered(
    undefined,
    { href: '/profile', children: 'Profile' },
    async () => assert.equal(observed.size, 1),
    { Component: ChromeLink }
  )
})
test('desktop chrome overrides explicit speculative opt-in without removing navigation', async () => {
  const { ChromeLink } = load(
    resolve(sourceRoot, 'app/components/navigation/ChromeLink.tsx')
  )
  await rendered(
    'desktop',
    { href: '/profile', prefetch: true, children: 'Profile' },
    async (host) => {
      assert.equal(host.querySelector('a')?.getAttribute('href'), '/profile')
      assert.equal(observed.size, 0)
    },
    { Component: ChromeLink }
  )
})
test('menu external anchor and server downloads availability remain unchanged', async () => {
  const { WorkspaceSectionMenuLink } = load(
    resolve(
      sourceRoot,
      'app/components/navigation/WorkspaceSectionMenuLink.tsx'
    )
  )
  await rendered(
    'desktop',
    {
      currentSeason: '9999',
      pathname: '/home',
      section: {
        href: 'https://example.com/help',
        label: 'Help',
        external: true
      },
      variant: 'mobile'
    },
    async (host) => {
      const anchor = host.querySelector('a')
      assert.equal(anchor.getAttribute('href'), 'https://example.com/help')
      assert.equal(anchor.getAttribute('target'), '_blank')
      assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer')
      assert.equal(observed.size, 0)
    },
    { Component: WorkspaceSectionMenuLink }
  )
  const Downloads = load(
    resolve(sourceRoot, 'app/downloads/DownloadsNavigationEntry.tsx')
  ).default
  try {
    downloadsState = { status: 'disabled' }
    assert.equal(await Downloads(), null)
    downloadsState = { status: 'ready', releases: [{ component: 'addon' }] }
    assert.equal(await Downloads(), null)
  } finally {
    downloadsState = { status: 'ready', releases: [{ component: 'core' }] }
  }
})

// This host-only file performs no HTTP, browser chunk loading, or native work.
after(() => {
  Module._resolveFilename = originalResolve
  window.happyDOM.cancelAsync()
  window.close()
  for (const [key, value] of originalTimers) globalThis[key] = value
})
