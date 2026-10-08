const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ordinary hydrated saved-season journey; caller owns synthetic session/inputs. */
exports.captureSeasonPlanning = async (window, config) => {
  assert(/^[1-9]\d{0,5}$/.test(config.season))
  const canEdit = config.canEdit !== false
  const run = (fn, ...args) =>
    window.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`)
  const wait = async (fn, ...args) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      await pause(100)
      if (await run(fn, ...args)) return
    }
    throw new Error('Saved season interface did not reach the expected state')
  }
  const button = (label) =>
    run((text) => {
      const element = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === text
      )
      if (!element || element.disabled)
        throw new Error('Expected saved-plan action unavailable')
      element.click()
    }, label)
  const read = () => {
    const output = document.querySelector('[aria-label="Season plan results"]')
    const saved = document.querySelector('[aria-label="Saved season plans"]')
    const rows = saved ? [...saved.querySelectorAll('tbody tr')] : []
    return {
      nodeAccess:
        typeof require !== 'undefined' || typeof process !== 'undefined',
      savedPlans: rows.length,
      source: [...document.querySelectorAll('[role="status"]')].some((e) =>
        e.textContent.includes('Calculations run locally; no live API request')
      ),
      accessBlocked: [...document.querySelectorAll('h1')].some((e) =>
        [
          'Connect your Player API key',
          'Add Guild and Guild Raid access'
        ].includes(e.textContent.trim())
      ),
      mutationControls: [...document.querySelectorAll('button')].some((e) =>
        [
          'Generate Plan',
          'Save Plan',
          'Save Changes',
          'Edit',
          'Delete'
        ].includes(e.textContent.trim())
      ),
      metrics:
        output && output.hasAttribute('data-tokens-spent')
          ? {
              tokensSpent: Number(output.dataset.tokensSpent),
              wastedTokens: Number(output.dataset.wastedTokens),
              bossesDefeated: Number(output.dataset.bossesDefeated),
              loopAdvances: Number(output.dataset.loopAdvances)
            }
          : null
    }
  }
  const url = new URL('/boss-assignments/season', window.webContents.getURL())
  url.searchParams.set('season', config.season)
  await window.loadURL(url.href)
  await wait(() => document.querySelector('[aria-label="Saved season plans"]'))
  const initial = await run(read)
  assert.equal(
    initial.nodeAccess,
    false,
    'Saved planner renderer remains sandboxed'
  )
  assert.equal(initial.accessBlocked, false, 'Saved season page is admitted')
  assert.equal(initial.source, true, 'Saved provenance must be visible')
  if (!canEdit)
    assert.equal(initial.mutationControls, false, 'Member cannot mutate plans')
  const firstRowAction = async (label) => {
    await run((text) => {
      const row = document.querySelector(
        '[aria-label="Saved season plans"] tbody tr'
      )
      const action =
        row &&
        [...row.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === text
        )
      if (!action || action.disabled)
        throw new Error('Saved row action unavailable')
      action.click()
    }, label)
  }
  const waitGenerated = (sessionsPerDay) =>
    wait((expected) => {
      const output = document.querySelector(
        '[aria-label="Season plan results"]'
      )
      const action = [...document.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === 'Generate Plan'
      )
      return (
        action &&
        !action.disabled &&
        !document.querySelector(
          '[aria-label="Season plan generation error"]'
        ) &&
        output?.hasAttribute('data-tokens-spent') &&
        Number(output.dataset.sessionsPerDay) === expected
      )
    }, sessionsPerDay)
  const readSaved = () =>
    run(async (season) => {
      const config = document.querySelector('[data-testid="snapshot-panel"]')
      if (!config) throw new Error('Saved snapshot missing')
      const selected = [...document.querySelectorAll('select')].find(
        (element) => element.labels?.[0]?.textContent.includes('Boss Rotation')
      )?.value
      const response = await fetch(
        '/api/guild-raid/season-plan?' +
          new URLSearchParams({ season_id: selected, season })
      )
      if (response.status !== 200)
        throw new Error('Saved list readback refused')
      const body = await response.json()
      return {
        id: body.plans[0]?.id,
        noStore: response.headers.get('cache-control') === 'no-store'
      }
    }, config.season)
  const results = []
  if (canEdit && config.exerciseMutations !== false) {
    if (config.snapshotAt) {
      await run((value) => {
        const input = document.querySelector(
          '[aria-label="Snapshot time (UTC)"]'
        )
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        ).set.call(input, value)
        input.dispatchEvent(new Event('input', { ['bub' + 'bles']: true }))
      }, config.snapshotAt)
      await button('Refresh Snapshot')
      await wait(
        (at) =>
          document.querySelector('[data-testid="snapshot-panel"]')?.dataset
            .snapshotAt === at,
        config.snapshotAt
      )
    }
    await button('Generate Plan')
    await waitGenerated(1)
    const generated = await run(read)
    if (config.expectedMetrics)
      assert.deepEqual(
        generated.metrics,
        config.expectedMetrics,
        'Worked numeric schedule must match'
      )
    results.push({ step: 'generated', ...generated })
    await button('Save Plan')
    await wait(
      (n) =>
        document.querySelectorAll('[aria-label="Saved season plans"] tbody tr')
          .length === n,
      initial.savedPlans + 1
    )
    const created = await readSaved()
    assert(
      created.id && created.noStore,
      'Saved create requires signed no-store readback'
    )
    await firstRowAction('Edit')
    await wait(() =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'Save Changes' && !b.disabled
      )
    )
    await run(() => {
      const select = [...document.querySelectorAll('select')].find((e) =>
        e.labels?.[0]?.textContent.includes('Sessions/day')
      )
      select.value = select.value === '1' ? '2' : '1'
      select.dispatchEvent(new Event('change', { ['bub' + 'bles']: true }))
    })
    await button('Generate Plan')
    await waitGenerated(2)
    await button('Save Changes')
    await wait((id) => {
      const action = [...document.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === 'Save Changes'
      )
      return (
        action &&
        !action.disabled &&
        !document.querySelector('[aria-label="Season plan save error"]') &&
        document
          .querySelector('[aria-label="Season plan save result"]')
          ?.textContent.trim() ===
          'Saved plan ' + id
      )
    }, created.id)
    assert.equal(
      (await run(read)).savedPlans,
      initial.savedPlans + 1,
      'Edit must update rather than duplicate'
    )
    const updated = await readSaved()
    assert.equal(
      updated.id,
      created.id,
      'Edit must retain the saved plan identity'
    )
    const persistedEdit = await run(async (id) => {
      const response = await fetch(
        '/api/guild-raid/season-plan?id=' + encodeURIComponent(id)
      )
      if (response.status !== 200)
        throw new Error('Saved edit readback refused')
      const body = await response.json()
      return {
        sessionsPerDay: body.plan.plan.sessions_per_day,
        noStore: response.headers.get('cache-control') === 'no-store'
      }
    }, created.id)
    assert.equal(
      persistedEdit.sessionsPerDay,
      2,
      'Stored plan must contain edited settings'
    )
    assert.equal(persistedEdit.noStore, true)
    await firstRowAction('Load')
    await wait(() =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'Loaded'
      )
    )
    results.push({ step: 'edited-loaded', ...(await run(read)) })
    await firstRowAction('Delete')
    await wait(
      (n) =>
        document.querySelectorAll('[aria-label="Saved season plans"] tbody tr')
          .length === n,
      initial.savedPlans
    )
    results.push({ step: 'deleted', ...(await run(read)) })
    await button('Generate Plan')
    await waitGenerated(2)
    await button('Save Plan')
    await wait(
      (n) =>
        document.querySelectorAll('[aria-label="Saved season plans"] tbody tr')
          .length === n,
      initial.savedPlans + 1
    )
    results.push({ step: 'saved-for-reopen', ...(await run(read)) })
  } else {
    const expected = config.expectedSavedPlans ?? 1
    await wait(
      (n) =>
        document.querySelectorAll('[aria-label="Saved season plans"] tbody tr')
          .length === n,
      expected
    )
    await firstRowAction('Load')
    await wait(() =>
      document
        .querySelector('[aria-label="Season plan results"]')
        ?.hasAttribute('data-tokens-spent')
    )
    const reopened = await run(read)
    if (config.expectedMetrics)
      assert.deepEqual(reopened.metrics, config.expectedMetrics)
    if (!canEdit) assert.equal(reopened.mutationControls, false)
    results.push({ step: 'loaded-saved', ...reopened })
  }
  if (config.screenshot)
    writeFileSync(
      config.screenshot,
      (await window.webContents.capturePage()).toPNG()
    )
  return {
    status: 'passed',
    classification: 'synthetic-installed-saved-season-renderer-slice',
    canEdit,
    source: 'saved-season',
    initial,
    results,
    fullFeatureAcceptance: false
  }
}
