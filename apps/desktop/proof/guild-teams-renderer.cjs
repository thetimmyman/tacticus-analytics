const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

exports.captureGuildTeams = async (window, config) => {
  const run = (fn, ...args) =>
    window.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`)
  const wait = async (fn, ...args) => {
    for (let i = 0; i < 100; i++) {
      if (await run(fn, ...args)) return
      await delay(100)
    }
    throw new Error(
      'Team renderer did not reach expected state: ' +
        String(fn) +
        '\n' +
        (await run(() => location.pathname + '\n' + document.body.innerText))
    )
  }
  await wait(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Custom'
    )
  )
  assert(
    await run(() => {
      const b = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Custom'
      )
      b.click()
      return true
    })
  )
  await wait(() => document.body.textContent.includes('Build Your Team'))
  for (const [tier, hero, score] of [
    [0, 'Synthetic Core', 12665],
    [1, 'Synthetic Support', 22668],
    [2, 'Synthetic Missing', 22667]
  ]) {
    await run(
      (tier) =>
        [...document.querySelectorAll('button')]
          .filter((b) => b.textContent.trim() === 'Add Hero')
          [tier].click(),
      tier
    )
    await wait(
      (hero) =>
        [...document.querySelectorAll('button')].some((b) =>
          b.textContent.trim().startsWith(hero)
        ),
      hero
    )
    await run(
      (hero) =>
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim().startsWith(hero))
          .click(),
      hero
    )
    await wait(
      (score) =>
        document
          .querySelector('[data-testid="local-team-score"]')
          ?.textContent.trim() === `Team score: ${score}`,
      score
    )
  }
  await run(() =>
    document.body.dispatchEvent(
      new MouseEvent('mousedown', { ['bub' + 'bles']: true })
    )
  )
  const before = await run(() => document.body.innerText)
  assert(before.includes('Synthetic Team Alias'))
  assert(before.includes('A:35 P:30'))
  assert(before.includes('A:55 P:30'))
  assert(before.includes('L40') && before.includes('L55'))
  assert(
    !before.includes('Synthetic Other Member') &&
      !before.includes('Synthetic Foreign Member')
  )
  assert(
    !before.includes('Failed to load roster data') &&
      !before.includes('Service Disruption')
  )
  await run(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Refresh')
      .click()
  )
  await wait(
    () =>
      !document.querySelector('button[title="Refresh roster data"]')?.disabled
  )
  assert.equal(
    await run(() =>
      document
        .querySelector('[data-testid="local-team-score"]')
        ?.textContent.trim()
    ),
    'Team score: 22667'
  )
  await run((value) => {
    const input = document.querySelector(
      'input[placeholder="Search player..."]'
    )
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, value)
    input.dispatchEvent(new Event('input', { ['bub' + 'bles']: true }))
  }, 'Synthetic Missing Player')
  await wait(() => !document.querySelector('[data-testid="local-team-score"]'))
  await run(() => {
    const input = document.querySelector(
      'input[placeholder="Search player..."]'
    )
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, '')
    input.dispatchEvent(new Event('input', { ['bub' + 'bles']: true }))
  })
  await wait(
    () =>
      document
        .querySelector('[data-testid="local-team-score"]')
        ?.textContent.trim() === 'Team score: 22667'
  )
  const text = await run(() => document.body.innerText)
  await delay(500)
  writeFileSync(
    config.screenshot.replace(/\.png$/, '-team.png'),
    (await window.webContents.capturePage()).toPNG(),
    { mode: 0o600 }
  )
  await window.loadURL(new URL('/roster', window.webContents.getURL()).href)
  await wait(() => document.body.innerText.includes('Refresh cached roster'))
  await delay(500)
  const rosterText = await run(() => document.body.innerText)
  assert(
    rosterText.includes('My Roster') &&
      rosterText.includes('Synthetic Core') &&
      rosterText.includes('Synthetic Support')
  )
  assert(
    !rosterText.includes('Player access is required') &&
      !rosterText.includes('No saved roster yet')
  )
  return {
    status: 'passed',
    teamScore: 22667,
    coreScore: 12665,
    secondaryScore: 10003,
    missingHeroScore: -1,
    ownMemberOnly: true,
    refreshPreservesScore: true,
    text,
    cachedRosterAfterDisconnect: true,
    rosterText
  }
}
