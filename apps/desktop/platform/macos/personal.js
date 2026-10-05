function inspect(value, label) {
  const item = document.createElement('details'),
    title = document.createElement('summary')
  title.textContent = label.replace(/([a-z])([A-Z])/g, '$1 $2')
  item.append(title)
  let page = 0
  const body = document.createElement('div')
  item.append(body)
  const render = () => {
    body.replaceChildren()
    if (value && typeof value === 'object') {
      const all = Object.entries(value),
        rows = all.slice(page * 25, (page + 1) * 25)
      for (const [key, child] of rows) {
        if (child && typeof child === 'object')
          body.append(
            inspect(
              child,
              Array.isArray(value) ? `Entry ${Number(key) + 1}` : key
            )
          )
        else {
          const row = document.createElement('p')
          row.textContent = `${key}: ${child}`
          body.append(row)
        }
      }
      if (all.length > 25) {
        for (const [label, change, disabled] of [
          ['Previous', -1, page === 0],
          ['Next', 1, (page + 1) * 25 >= all.length]
        ]) {
          const button = document.createElement('button')
          button.textContent = label
          button.disabled = disabled
          button.addEventListener('click', () => {
            page += change
            render()
          })
          body.append(button)
        }
      }
      if (!all.length) body.textContent = 'No entries returned.'
    } else body.textContent = String(value ?? 'Unavailable')
  }
  item.addEventListener('toggle', () => {
    if (item.open) render()
    else body.replaceChildren()
  })
  return item
}

async function refresh() {
  try {
    const response = await fetch('/api/desktop/personal', {
      credentials: 'same-origin',
      cache: 'no-store'
    })
    if (response.status === 401) {
      window.location.assign('/desktop/setup')
      return
    }
    if (!response.ok)
      throw new Error(
        'Local data is unavailable. Reopen the workspace to retry.'
      )
    const view = await response.json()
    document.querySelector('#status').textContent = view.personal
      ? 'Reading cached personal data. Updates require valid official access.'
      : 'Player access is required. Use the native Official access menu to connect.'
    document.querySelector('#name').textContent =
      view.personal?.displayName ?? 'Personal workspace'
    document.querySelector('#freshness').textContent = view.freshness?.syncedAt
      ? `Last official update: ${new Date(view.freshness.syncedAt).toLocaleString()}`
      : 'No official data has been synced.'
    const capabilities = document.querySelector('#capabilities')
    capabilities.replaceChildren()
    for (const scope of view.requestedCapabilities) {
      const item = document.createElement('li')
      item.textContent = `${scope}: ${view.capabilities[scope] ?? 'not connected'}`
      capabilities.append(item)
    }
    const resources = view.personal?.resources
    document.querySelector('#resources').textContent = resources
      ? `Raid tokens: ${resources.guildRaidTokens?.current ?? 'unavailable'}; bomb tokens: ${resources.bombTokens?.current ?? 'unavailable'}`
      : 'Waiting for Player data.'
    const roster = document.querySelector('#roster')
    roster.replaceChildren()
    for (const unit of view.personal?.roster ?? []) {
      const row = document.createElement('tr')
      for (const value of [unit.name ?? unit.id, unit.rank, unit.xpLevel]) {
        const cell = document.createElement('td')
        cell.textContent = String(value ?? '—')
        row.append(cell)
      }
      roster.append(row)
    }
    const snapshot = document.querySelector('#snapshot')
    snapshot.replaceChildren()
    for (const [key, value] of Object.entries(view.personal?.apiData ?? {}))
      snapshot.append(inspect(value, key))
    document.querySelector('#limitation').textContent = view.limitation
  } catch (error) {
    document.querySelector('#status').textContent = error.message
  }
}
void refresh()
window.addEventListener('focus', refresh)
