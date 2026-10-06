import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const { externalWebsiteUrl, installExternalLinks } = createRequire(
  import.meta.url
)('../launcher/external-links.cjs')
const origin = 'http://127.0.0.1:54321'
const website = 'https://example.invalid/synthetic-planner?view=offline'
const settle = () => new Promise((resolve) => setImmediate(resolve))

function fixture(options = {}) {
  const webContents = new EventEmitter()
  const f = {
    prompts: [],
    opened: [],
    response: 0,
    location: origin + '/roster',
    destroyed: false
  }
  webContents.getURL = () => f.location
  webContents.setWindowOpenHandler = (handler) => {
    f.popup = handler
  }
  const window = { webContents, isDestroyed: () => f.destroyed }
  installExternalLinks(window, origin, {
    dialog: {
      async showMessageBox(_window, prompt) {
        f.prompts.push(prompt)
        if (f.pending) return f.pending
        return { response: f.response }
      }
    },
    shell: {
      async openExternal(url) {
        f.opened.push(url)
        if (f.failOpen) throw new Error('Synthetic browser failure')
      }
    },
    ...options
  })
  f.navigate = (url, eventName = 'will-navigate') => {
    let prevented = false
    webContents.emit(eventName, {
      url,
      preventDefault() {
        prevented = true
      }
    })
    return prevented
  }
  return f
}

test('only bounded credential-free HTTP(S) websites reach browser consent', () => {
  assert.equal(externalWebsiteUrl(website, origin), website)
  assert.equal(
    externalWebsiteUrl('http://example.invalid/', origin),
    'http://example.invalid/'
  )
  for (const value of [
    undefined,
    '',
    '/roster',
    'file:///synthetic',
    'javascript:alert(1)',
    'data:text/html,synthetic',
    'mailto:synthetic@example.invalid',
    'https://synthetic:password@example.invalid/',
    'https://example.invalid/\n',
    'https://example.invalid/ space',
    'https:\\example.invalid',
    origin + '/desktop/setup',
    'https://example.invalid/' + 'x'.repeat(2048)
  ])
    assert.equal(externalWebsiteUrl(value, origin), null)
})

test('popup is denied in app and default-cancel native consent precedes browser dispatch', async () => {
  const f = fixture()
  assert.deepEqual(f.popup({ url: website }), { action: 'deny' })
  await settle()
  assert.equal(f.prompts.length, 1)
  assert.equal(f.prompts[0].detail, website)
  assert.equal(f.prompts[0].defaultId, 0)
  assert.equal(f.prompts[0].cancelId, 0)
  assert.deepEqual(f.opened, [])
  f.response = 1
  f.popup({ url: website })
  await settle()
  assert.deepEqual(f.opened, [website])
  assert.equal(f.navigate(origin + '/profile'), false)
  assert.equal(f.navigate(website), true)
  await settle()
  assert.deepEqual(f.opened, [website, website])
})

test('invalid links, POST popups, redirects and verification mode never invoke browser', async () => {
  const f = fixture()
  f.response = 1
  f.popup({ url: 'file:///synthetic' })
  f.popup({ url: website, postBody: { data: 'synthetic' } })
  assert.equal(f.navigate(website, 'will-redirect'), true)
  const disabled = fixture({ enabled: false })
  disabled.popup({ url: website })
  await settle()
  assert.deepEqual(f.prompts, [])
  assert.deepEqual(f.opened, [])
  assert.deepEqual(disabled.prompts, [])
})

test('pending consent is single-flight and closing or navigating away cancels dispatch', async () => {
  for (const change of ['destroyed', 'location']) {
    const f = fixture()
    let complete
    f.pending = new Promise((resolve) => {
      complete = resolve
    })
    f.popup({ url: website })
    f.popup({ url: website })
    assert.equal(f.prompts.length, 1)
    if (change === 'destroyed') f.destroyed = true
    else f.location = 'https://foreign.invalid/'
    complete({ response: 1 })
    await settle()
    assert.deepEqual(f.opened, [])
  }
})

test('foreign renderer is refused; browser errors stay native and leave app available', async () => {
  const f = fixture()
  f.location = 'https://foreign.invalid/'
  f.popup({ url: website })
  await settle()
  assert.deepEqual(f.prompts, [])
  f.location = origin + '/roster'
  f.response = 1
  f.failOpen = true
  f.popup({ url: website })
  await settle()
  assert.equal(f.prompts[1].type, 'error')
  f.failOpen = false
  f.popup({ url: website })
  await settle()
  assert.equal(f.opened.length, 2)
})
