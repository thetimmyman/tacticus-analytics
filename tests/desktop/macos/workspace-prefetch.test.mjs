import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { readFileSync } from 'node:fs'
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
function load(file) {
  file = resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = new Module(file)
  cache.set(file, mod)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(sourceRoot)
  mod.require = (id) => {
    if (id === 'next/link')
      return requireActual('next/dist/client/app-dir/link')
    if (id === './workspaces')
      return load(sourceRoot + '/app/components/navigation/workspaces.ts')
    if (id.startsWith('@/'))
      return load(sourceRoot + '/' + id.slice(2) + (extname(id) ? '' : '.ts'))
    if (id.startsWith('@tacticus/app-core/'))
      return load(
        sourceRoot +
          '/packages/app-core/src/' +
          id.slice('@tacticus/app-core/'.length) +
          '.ts'
      )
    if (id.startsWith('.'))
      return load(resolve(dirname(file), id) + (extname(id) ? '' : '.ts'))
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

// This host-only file performs no HTTP, browser chunk loading, or native work.
after(() => {
  Module._resolveFilename = originalResolve
  window.happyDOM.cancelAsync()
  window.close()
})
