const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Hydrated signed-in officer journey; fixtures and session enrollment are caller-owned. */
exports.captureTokenUsage = async (window, config) => {
  assert(
    Array.isArray(config.expectedPlayers) && config.expectedPlayers.length > 0
  )
  assert(config.expectedPlayers.length <= 30)
  const run = (fn, ...args) =>
    window.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`)
  const wait = async (fn, ...args) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(fn, ...args)) return
      await pause(100)
    }
    throw new Error('Cached token interface did not reach expected state')
  }
  const url = new URL('/token-usage', window.webContents.getURL())
  url.searchParams.set('guild', config.guild)
  url.searchParams.set('season', config.season)
  await window.loadURL(url.href)
  await wait(() =>
    document.querySelector('[aria-label="Saved token availability"] table')
  )
  const read = () => {
    const section = document.querySelector(
      '[aria-label="Saved token availability"]'
    )
    return {
      rows: [...section.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent.trim())
      ),
      status: section.querySelector('[role="status"]').textContent,
      nodeAccess:
        typeof require !== 'undefined' || typeof process !== 'undefined',
      liveControls: [...document.querySelectorAll('button,input')].some(
        (element) =>
          /sync guild|save api key/i.test(
            element.textContent || element.getAttribute('placeholder') || ''
          )
      ),
      accessBlocked:
        document.body.innerText.includes('Connect your Player API key') ||
        document.body.innerText.includes('Add Guild and Guild Raid access')
    }
  }
  const initial = await run(read)
  assert.equal(initial.nodeAccess, false)
  assert.equal(initial.liveControls, false)
  assert.equal(initial.accessBlocked, false)
  assert(initial.status.includes('No live API request'))
  for (const expected of config.expectedPlayers) {
    const row = initial.rows.find((cells) => cells[0] === expected.name)
    assert(row, 'Expected synthetic member row missing')
    assert.equal(row[1], `${expected.tokens} / 3`)
    assert.equal(row[3], `${expected.bombs} / 1`)
    assert.equal(row[7], expected.source)
    if (expected.savedAt) assert.equal(row[8], expected.savedAt)
    if (expected.lostTokens !== undefined)
      assert.equal(row[5], String(expected.lostTokens))
  }
  const response = await run(
    async (guild, season) => {
      const params = new URLSearchParams({ guild, season })
      const usage = await fetch('/api/members/token-usage?' + params)
      const availability = await fetch('/api/guild-tokens?' + params)
      const rows = await usage.json()
      const state = await availability.json()
      return {
        usage: usage.status,
        availability: availability.status,
        usageNoStore: usage.headers.get('cache-control') === 'no-store',
        availabilityNoStore:
          availability.headers.get('cache-control') === 'no-store',
        cachedMode: state.read_mode === 'cached',
        noLiveFetched: state.debug.live_api_fetched === 0,
        usageRows: rows.map((row) => ({
          tokens: row.tokens_used,
          available: row.tokens_available,
          bombs: row.bombs_available_live,
          source: row.data_source,
          savedAt: row.last_sync_at
        }))
      }
    },
    config.guild,
    config.season
  )
  assert.equal(response.usage, 200)
  assert.equal(response.availability, 200)
  assert(
    response.usageNoStore &&
      response.availabilityNoStore &&
      response.cachedMode &&
      response.noLiveFetched
  )
  await run(() =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Recalculate saved data')
      .click()
  )
  await wait(
    (before) =>
      document.querySelector(
        '[aria-label="Saved token availability"] [role="status"]'
      ).textContent !== before,
    initial.status
  )
  const refreshed = await run(read)
  assert.deepEqual(refreshed.rows, initial.rows)
  assert.equal(refreshed.nodeAccess, false)
  if (config.screenshot)
    writeFileSync(
      config.screenshot,
      (await window.webContents.capturePage()).toPNG(),
      { mode: 0o600 }
    )
  return {
    status: 'passed',
    normalHydratedInterface: true,
    cachedAccess: true,
    expectedNumericRows: config.expectedPlayers.length,
    refreshPreservedState: true,
    initial,
    refreshed,
    endpoints: response
  }
}
