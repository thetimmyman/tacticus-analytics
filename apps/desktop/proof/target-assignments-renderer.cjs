const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const keyFor = (row) =>
  `${row.bossType}__${row.rarity}__${row.set}__${row.encounterId}`

/** Hydrated target journey; synthetic expected values and enrollment are caller-owned. */
exports.captureTargetAssignments = async (window, config) => {
  assert(Array.isArray(config.expectedTargets))
  assert(
    config.expectedTargets.length > 0 && config.expectedTargets.length <= 30
  )
  assert.equal(typeof config.canEdit, 'boolean')
  if (config.edit || config.delete) assert.equal(config.canEdit, true)
  if (config.edit?.skip) assert.notEqual(config.edit.key.encounterId, 0)
  const run = (fn, ...args) =>
    window.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`)
  const wait = async (fn, ...args) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(fn, ...args)) return
      await pause(100)
    }
    throw new Error('Target interface did not reach expected saved state')
  }
  const readTargets = async () => {
    const response = await run(
      async (guild, season) => {
        const params = new URLSearchParams({ guild_code: guild, season })
        const response = await fetch(
          '/api/boss-assignments/target-tokens?' + params
        )
        const body = await response.json()
        return { status: response.status, rows: body.rows }
      },
      config.guild,
      config.season
    )
    assert.equal(response.status, 200)
    assert(Array.isArray(response.rows))
    return response.rows
  }
  const find = (rows, key) =>
    rows.find(
      (row) =>
        row.boss_name === key.bossType &&
        row.rarity === key.rarity &&
        Number(row.set) === key.set &&
        Number(row.encounter_id) === key.encounterId
    )
  const readInterface = () => ({
    nodeAccess:
      typeof require !== 'undefined' || typeof process !== 'undefined',
    savedDataNotice: document.body.innerText.includes(
      'Targets and actual-token comparisons use saved local data.'
    ),
    mutationControls: document.querySelectorAll(
      '[data-testid="targets-mutation-control"]'
    ).length,
    errors: [...document.querySelectorAll('[role="alert"]')].map(
      (item) => item.textContent
    ),
    liveSeedControl: [...document.querySelectorAll('button')].some(
      (button) => button.textContent.trim() === 'Seed from history'
    )
  })
  const rowAction = (key, action, value) => {
    const row = [...document.querySelectorAll('tr[data-target-key]')].find(
      (item) =>
        item.dataset.targetKey === key && item.getClientRects().length > 0
    )
    if (!row) throw new Error('Expected visible target table row missing')
    const button = (text) =>
      [...row.querySelectorAll('button')].find(
        (item) => item.textContent.trim() === text
      )
    if (action === 'edit') {
      const edit = button('Edit') || button('Add')
      if (!edit || edit.disabled)
        throw new Error('Expected editable target missing')
      edit.click()
    } else if (action === 'value') {
      const input = row.querySelector('input[type="number"]')
      if (!input) throw new Error('Target value editor missing')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else if (action === 'save') {
      button('Save').click()
    } else if (action === 'notes') {
      row.querySelector('button[aria-label^="Edit target notes for "]').click()
    } else if (action === 'note-value') {
      const input = row.querySelector('textarea')
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      ).set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else if (action === 'note-save') {
      button('Save target notes').click()
    } else if (action === 'skip') {
      const input = row.querySelector('input[type="checkbox"]')
      if (!input || input.disabled)
        throw new Error('Prime skip control missing')
      if (input.checked !== value) input.click()
    } else if (action === 'reset') {
      const reset = button('Reset')
      if (!reset || reset.disabled)
        throw new Error('Manual target reset missing')
      reset.click()
    }
  }
  const url = new URL('/boss-assignments/targets', window.webContents.getURL())
  url.searchParams.set('season', config.season)
  await window.loadURL(url.href)
  await wait(() => document.querySelector('tr[data-target-key]'))
  if (
    [...config.expectedTargets, config.edit?.key, config.delete?.key].some(
      (key) => key && key.encounterId > 0
    )
  ) {
    await run(() => {
      const label = [...document.querySelectorAll('label')].find(
        (item) => item.textContent.trim() === 'Primes'
      )
      const checkbox = label?.querySelector('input[type="checkbox"]')
      if (!checkbox) throw new Error('Normal prime visibility control missing')
      if (!checkbox.checked) checkbox.click()
    })
    await wait(
      (keys) =>
        keys.every((key) =>
          [...document.querySelectorAll('tr[data-target-key]')].some(
            (row) => row.dataset.targetKey === key
          )
        ),
      config.expectedTargets.map(keyFor)
    )
  }
  const initial = await run(readInterface)
  assert.equal(initial.nodeAccess, false)
  assert.equal(initial.savedDataNotice, true)
  assert.equal(initial.liveSeedControl, false)
  assert.deepEqual(initial.errors, [])
  if (config.canEdit) assert(initial.mutationControls > 0)
  else assert.equal(initial.mutationControls, 0)
  const initialRows = await readTargets()
  for (const expected of config.expectedTargets) {
    const saved = find(initialRows, expected)
    assert(saved, 'Expected saved target missing')
    assert.equal(Number(saved.target_tokens), expected.targetTokens)
    assert.equal(saved.notes, expected.notes)
    assert.equal(saved.skip, expected.skip)
    if (expected.storedSeason !== undefined)
      assert.equal(saved.season_number, expected.storedSeason)
    const rendered = await run((key) => {
      const row = [...document.querySelectorAll('tr[data-target-key]')].find(
        (item) => item.dataset.targetKey === key
      )
      return row
        ? {
            text: row.innerText,
            target:
              row.children[3].querySelector('span.font-semibold')
                ?.textContent ?? null,
            skipped: row.children[3].textContent.includes('skipped'),
            titles: [...row.querySelectorAll('[title]')].map(
              (item) => item.title
            )
          }
        : null
    }, keyFor(expected))
    assert(rendered, 'Expected scheduled target missing')
    if (expected.skip) assert.equal(rendered.skipped, true)
    else assert.equal(rendered.target, String(expected.targetTokens))
    if (expected.displayName)
      assert(rendered.text.includes(expected.displayName))
    if (expected.notes) assert(rendered.text.includes(expected.notes))
    if (expected.actualTokens !== undefined)
      assert(
        rendered.text.includes(`actual ≈ ${expected.actualTokens.toFixed(1)}`)
      )
    if (
      expected.actualSeason !== undefined &&
      expected.actualSampleCount !== undefined
    )
      assert(
        rendered.titles.includes(
          `Recent guild actual: ${expected.actualTokens.toFixed(1)} tokens to kill (S${expected.actualSeason}, ${expected.actualSampleCount} attacks)`
        )
      )
  }
  const waitStored = async (key, expected) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const saved = find(await readTargets(), key)
      if (
        saved &&
        Object.entries(expected).every(([name, value]) => saved[name] === value)
      )
        return
      await pause(100)
    }
    throw new Error('Target mutation did not persist the expected values')
  }
  if (config.edit) {
    const edit = config.edit
    const key = keyFor(edit.key)
    await run(rowAction, key, 'edit')
    await run(rowAction, key, 'value', edit.targetTokens)
    await run(rowAction, key, 'save')
    await waitStored(edit.key, {
      target_tokens: edit.targetTokens,
      skip: false,
      season_number: config.season
    })
    await wait(
      (key, tokens) =>
        [...document.querySelectorAll('tr[data-target-key]')].some(
          (row) =>
            row.dataset.targetKey === key &&
            !row.querySelector('input[type="number"]') &&
            row.children[3].querySelector('span.font-semibold')?.textContent ===
              String(tokens)
        ),
      key,
      edit.targetTokens
    )
    await run(rowAction, key, 'notes')
    await run(rowAction, key, 'note-value', edit.notes)
    await run(rowAction, key, 'note-save')
    await waitStored(edit.key, {
      target_tokens: edit.targetTokens,
      notes: edit.notes || null,
      skip: false
    })
    await wait(
      (key, notes) =>
        [...document.querySelectorAll('tr[data-target-key]')].some(
          (row) =>
            row.dataset.targetKey === key &&
            !row.querySelector('textarea') &&
            (!notes || row.innerText.includes(notes))
        ),
      key,
      edit.notes
    )
    if (edit.key.encounterId !== 0) {
      await run(rowAction, key, 'skip', edit.skip)
      await wait(
        (key, skip) =>
          [...document.querySelectorAll('tr[data-target-key]')].some(
            (row) =>
              row.dataset.targetKey === key &&
              row.querySelector('input[type="checkbox"]')?.checked === skip
          ),
        key,
        edit.skip
      )
    }
    await waitStored(edit.key, {
      target_tokens: edit.targetTokens,
      notes: edit.notes || null,
      skip: edit.skip
    })
  }
  if (config.delete) {
    await run(rowAction, keyFor(config.delete.key), 'reset')
    for (let attempt = 0; attempt < 100; attempt++) {
      const saved = find(await readTargets(), config.delete.key)
      if (
        config.delete.fallbackTargetTokens === null
          ? !saved
          : saved &&
            Number(saved.target_tokens) ===
              config.delete.fallbackTargetTokens &&
            saved.season_number === (config.delete.fallbackStoredSeason ?? '')
      )
        break
      if (attempt === 99)
        throw new Error('Target reset did not expose the expected fallback')
      await pause(100)
    }
  }
  if (config.delete) {
    await wait(
      (key, tokens) => {
        const row = [...document.querySelectorAll('tr[data-target-key]')].find(
          (item) => item.dataset.targetKey === key
        )
        const target =
          row?.children[3].querySelector('span.font-semibold')?.textContent ??
          null
        return target === (tokens === null ? null : String(tokens))
      },
      keyFor(config.delete.key),
      config.delete.fallbackTargetTokens
    )
  }
  const final = await run(readInterface)
  assert.deepEqual(final.errors, [])
  assert.equal(final.nodeAccess, false)
  if (config.screenshot)
    writeFileSync(
      config.screenshot,
      (await window.webContents.capturePage()).toPNG(),
      { mode: 0o600 }
    )
  return {
    status: 'passed',
    normalHydratedInterface: true,
    expectedSavedTargets: config.expectedTargets.length,
    memberReadOnly: !config.canEdit,
    officerValueNotesSkip: Boolean(config.edit),
    exactStoredSeasonReset: Boolean(config.delete),
    initial,
    final
  }
}
