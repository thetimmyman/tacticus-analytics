const PAGE_SIZE = 25
const inventoryCategories = [
  ['items', 'Items'],
  ['upgrades', 'Upgrades'],
  ['shards', 'Shards'],
  ['mythicShards', 'Mythic shards'],
  ['xpBooks', 'XP books'],
  ['components', 'Components'],
  ['forgeBadges', 'Forge badges']
]

function total(entries, field) {
  if (entries.some((entry) => !Number.isSafeInteger(entry[field])))
    return 'Not returned'
  return entries
    .reduce((sum, entry) => sum + BigInt(entry[field]), 0n)
    .toString()
}

export function inventoryRows(inventory = {}) {
  const rows = []
  const add = (category, entry, group) => {
    rows.push({
      category,
      label: entry.name ?? entry.id ?? group ?? category,
      amount: entry.amount,
      id: entry.id,
      level: entry.level,
      rarity: entry.rarity,
      grandAlliance: entry.grandAlliance,
      group
    })
  }
  for (const [field, label] of inventoryCategories)
    for (const entry of inventory[field] ?? []) add(label, entry)
  for (const [field, label] of [
    ['abilityBadges', 'Ability badges'],
    ['orbs', 'Orbs']
  ])
    for (const [group, entries] of Object.entries(inventory[field] ?? {}))
      for (const entry of entries) add(label, entry, group)
  if (inventory.requisitionOrders)
    for (const field of ['regular', 'blessed'])
      add('Requisition orders', {
        name: field,
        amount: inventory.requisitionOrders[field]
      })
  if (inventory.resetStones !== undefined)
    add('Reset stones', { amount: inventory.resetStones })
  return rows
}

export function playerSummary(apiData) {
  if (!apiData) return null
  const units = apiData.units,
    campaigns = apiData.progress.campaigns,
    battles = campaigns.flatMap((campaign) => campaign.battles),
    inventory = inventoryRows(apiData.inventory)
  return {
    units: units.length,
    unitShards: total(units, 'shards'),
    unitMythicShards: total(units, 'mythicShards'),
    campaigns: campaigns.length,
    campaignBattles: battles.length,
    campaignAttemptsLeft: total(battles, 'attemptsLeft'),
    campaignAttemptsUsed: total(battles, 'attemptsUsed'),
    inventory: [...new Set(inventory.map((row) => row.category))].map(
      (category) => ({
        category,
        amount: total(
          inventory.filter((row) => row.category === category),
          'amount'
        )
      })
    )
  }
}

function node(document, tag, text, attributes = {}) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = String(text)
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, value)
  return element
}

function fields(document, pairs) {
  const list = node(document, 'dl')
  for (const [label, value] of pairs) {
    list.append(
      node(document, 'dt', label),
      node(document, 'dd', value ?? 'Not returned')
    )
  }
  return list
}

function table(document, headings) {
  const result = node(document, 'table'),
    header = node(document, 'thead'),
    row = node(document, 'tr'),
    body = node(document, 'tbody')
  for (const heading of headings)
    row.append(node(document, 'th', heading, { scope: 'col' }))
  header.append(row)
  result.append(header, body)
  return { result, body }
}

function pager(document, root, label, renderEntry) {
  const rows = node(document, 'div'),
    status = node(document, 'p', '', { role: 'status', 'aria-live': 'polite' }),
    navigation = node(document, 'nav', undefined, {
      'aria-label': `${label} pages`
    }),
    previous = node(document, 'button', 'Previous', { type: 'button' }),
    next = node(document, 'button', 'Next', { type: 'button' })
  let entries = [],
    page = 0
  navigation.append(previous, next)
  root.append(status, rows, navigation)
  function render() {
    const start = page * PAGE_SIZE
    rows.replaceChildren()
    if (!entries.length)
      rows.append(node(document, 'p', 'No matching entries.'))
    else
      for (const entry of entries.slice(start, start + PAGE_SIZE))
        rows.append(renderEntry(entry))
    status.textContent = entries.length
      ? `${label}: ${start + 1}–${Math.min(start + PAGE_SIZE, entries.length)} of ${entries.length}.`
      : `${label}: 0 entries.`
    previous.disabled = page === 0
    next.disabled = (page + 1) * PAGE_SIZE >= entries.length
  }
  previous.addEventListener('click', () => {
    page -= 1
    render()
  })
  next.addEventListener('click', () => {
    page += 1
    render()
  })
  return {
    update(values) {
      entries = values
      page = 0
      render()
    }
  }
}

function details(document, title, render) {
  const result = node(document, 'details'),
    summary = node(document, 'summary', title),
    body = node(document, 'div')
  result.append(summary, body)
  result.addEventListener('toggle', () => {
    if (result.open) {
      if (!body.childElementCount) render(body)
    } else body.replaceChildren()
  })
  return result
}

function unitDetails(document, unit) {
  return details(document, `Details for ${unit.name ?? unit.id}`, (body) => {
    body.append(
      fields(document, [
        ['Unit ID', unit.id],
        ['Faction', unit.faction],
        ['Grand alliance', unit.grandAlliance],
        ['Rank', unit.rank],
        ['XP level', unit.xpLevel],
        ['Reported XP', unit.xp],
        ['Progression index', unit.progressionIndex],
        ['Shards', unit.shards],
        ['Mythic shards', unit.mythicShards]
      ])
    )
    for (const [label, entries, render] of [
      [
        'Abilities',
        unit.abilities,
        (entry) =>
          fields(document, [
            ['Ability ID', entry.id],
            ['Level', entry.level]
          ])
      ],
      [
        'Equipment',
        unit.items,
        (entry) =>
          fields(document, [
            ['Slot', entry.slotId],
            ['Item ID', entry.id],
            ['Name', entry.name],
            ['Level', entry.level],
            ['Rarity', entry.rarity]
          ])
      ],
      [
        'Upgrade entries',
        unit.upgrades.map((value, index) => ({ value, index })),
        (entry) =>
          fields(document, [
            ['Entry', entry.index + 1],
            ['Returned value', entry.value]
          ])
      ]
    ]) {
      const section = node(document, 'section')
      section.append(node(document, 'h4', label))
      body.append(section)
      pager(document, section, label, render).update(entries)
    }
  })
}

function labeledControl(document, root, label, control) {
  const wrapper = node(document, 'label', label)
  wrapper.append(control)
  root.append(wrapper)
  return control
}

function selector(document, choices, label) {
  const select = node(document, 'select', undefined, { 'aria-label': label })
  for (const [value, text] of choices)
    select.append(node(document, 'option', text, { value }))
  return select
}

function rosterView(document, root, apiData, retained) {
  root.replaceChildren()
  if (!apiData) {
    root.append(node(document, 'p', 'Waiting for cached Player data.'))
    return
  }
  const units = apiData.units,
    summary = playerSummary(apiData)
  root.append(
    node(
      document,
      'p',
      `${summary.units} returned units; ${summary.unitShards} unit shards; ${summary.unitMythicShards} unit mythic shards.`
    )
  )
  const controls = node(document, 'div'),
    query = labeledControl(
      document,
      controls,
      'Search units ',
      node(document, 'input', undefined, {
        type: 'search',
        maxlength: '100',
        'aria-label': 'Search cached units',
        placeholder: 'Name, unit ID or faction'
      })
    ),
    alliance = labeledControl(
      document,
      controls,
      'Grand alliance ',
      selector(
        document,
        [
          ['', 'Any alliance'],
          ['Imperial', 'Imperial'],
          ['Xenos', 'Xenos'],
          ['Chaos', 'Chaos']
        ],
        'Filter units by grand alliance'
      )
    ),
    sort = labeledControl(
      document,
      controls,
      'Sort ',
      selector(
        document,
        [
          ['name', 'Name'],
          ['rank', 'Rank, highest first'],
          ['xpLevel', 'XP level, highest first'],
          ['progressionIndex', 'Progression index, highest first']
        ],
        'Sort cached units'
      )
    ),
    list = node(document, 'div')
  query.value = retained.query
  alliance.value = retained.alliance
  sort.value = retained.sort
  root.append(controls, list)
  const pages = pager(document, list, 'Units', (unit) => {
    const article = node(document, 'article', undefined, {
      'data-cached-unit': ''
    })
    article.append(
      node(document, 'h3', unit.name ?? unit.id),
      node(
        document,
        'p',
        `Rank ${unit.rank}; XP level ${unit.xpLevel}; progression index ${unit.progressionIndex}.`
      ),
      unitDetails(document, unit)
    )
    return article
  })
  function filter() {
    retained.query = query.value.slice(0, 100)
    retained.alliance = alliance.value
    retained.sort = sort.value
    const search = retained.query.toLocaleLowerCase()
    const selected = units.filter(
      (unit) =>
        (!retained.alliance || unit.grandAlliance === retained.alliance) &&
        [unit.name, unit.id, unit.faction].some((value) =>
          String(value ?? '')
            .toLocaleLowerCase()
            .includes(search)
        )
    )
    selected.sort((a, b) =>
      retained.sort === 'name'
        ? String(a.name ?? a.id).localeCompare(String(b.name ?? b.id))
        : b[retained.sort] - a[retained.sort] ||
          String(a.id).localeCompare(String(b.id))
    )
    pages.update(selected)
  }
  query.addEventListener('input', filter)
  alliance.addEventListener('change', filter)
  sort.addEventListener('change', filter)
  filter()
}

function resourcesView(document, root, apiData, retained) {
  root.replaceChildren()
  if (!apiData) return
  const progress = apiData.progress,
    tokenTable = table(document, [
      'Activity',
      'Current',
      'Maximum',
      'Next token seconds at snapshot',
      'Regeneration seconds'
    ])
  root.append(
    node(document, 'h3', 'Activity tokens'),
    node(
      document,
      'p',
      'These are the returned snapshot values. Timers do not count down while offline.'
    ),
    tokenTable.result
  )
  for (const [label, token] of [
    ['Arena', progress.arena?.tokens],
    ['Guild Raid', progress.guildRaid?.tokens],
    ['Bomb tokens', progress.guildRaid?.bombTokens],
    ['Onslaught', progress.onslaught?.tokens],
    ['Salvage Run', progress.salvageRun?.tokens]
  ]) {
    const row = node(document, 'tr')
    for (const value of [
      label,
      token?.current,
      token?.max,
      token?.nextTokenInSeconds,
      token?.regenDelayInSeconds
    ])
      row.append(node(document, 'td', value ?? 'Not returned'))
    tokenTable.body.append(row)
  }
  const summary = node(document, 'dl')
  for (const entry of playerSummary(apiData).inventory)
    summary.append(
      node(document, 'dt', `${entry.category}: reported amount`),
      node(document, 'dd', entry.amount)
    )
  root.append(node(document, 'h3', 'Inventory totals'), summary)
  const rows = inventoryRows(apiData.inventory),
    controls = node(document, 'div'),
    query = labeledControl(
      document,
      controls,
      'Search inventory ',
      node(document, 'input', undefined, {
        type: 'search',
        maxlength: '100',
        'aria-label': 'Search cached inventory',
        placeholder: 'Name, ID, group or rarity'
      })
    ),
    category = labeledControl(
      document,
      controls,
      'Category ',
      selector(
        document,
        [
          ['', 'All categories'],
          ...[...new Set(rows.map((row) => row.category))].map((value) => [
            value,
            value
          ])
        ],
        'Filter inventory category'
      )
    ),
    list = node(document, 'div')
  query.value = retained.query
  category.value = retained.category
  root.append(node(document, 'h3', 'Inventory entries'), controls, list)
  const pages = pager(document, list, 'Inventory', (entry) => {
    const article = node(document, 'article', undefined, {
      'data-cached-resource': ''
    })
    article.append(
      node(document, 'h4', `${entry.category}: ${entry.label}`),
      fields(document, [
        ['Reported amount', entry.amount],
        ['ID', entry.id],
        ['Level', entry.level],
        ['Rarity', entry.rarity],
        ['Grand alliance', entry.grandAlliance],
        ['Group', entry.group]
      ])
    )
    return article
  })
  function filter() {
    retained.query = query.value.slice(0, 100)
    retained.category = category.value
    const search = retained.query.toLocaleLowerCase()
    pages.update(
      rows.filter(
        (row) =>
          (!retained.category || row.category === retained.category) &&
          [row.label, row.id, row.group, row.rarity, row.grandAlliance].some(
            (value) =>
              String(value ?? '')
                .toLocaleLowerCase()
                .includes(search)
          )
      )
    )
  }
  query.addEventListener('input', filter)
  category.addEventListener('change', filter)
  filter()
}

function progressView(document, root, apiData) {
  root.replaceChildren()
  if (!apiData) return
  const summary = playerSummary(apiData),
    campaigns = node(document, 'div'),
    events = node(document, 'div')
  root.append(
    node(
      document,
      'p',
      `${summary.campaigns} returned campaigns; ${summary.campaignBattles} battle entries; ${summary.campaignAttemptsLeft} reported attempts left; ${summary.campaignAttemptsUsed} reported attempts used.`
    ),
    node(document, 'h3', 'Campaigns'),
    campaigns
  )
  pager(document, campaigns, 'Campaigns', (campaign) =>
    details(document, `${campaign.name} (${campaign.type})`, (body) => {
      body.append(
        fields(document, [
          ['Campaign ID', campaign.id],
          ['Battle entries', campaign.battles.length],
          ['Reported attempts left', total(campaign.battles, 'attemptsLeft')],
          ['Reported attempts used', total(campaign.battles, 'attemptsUsed')]
        ])
      )
      pager(document, body, 'Battles', (battle) =>
        fields(document, [
          ['Battle index', battle.battleIndex],
          ['Attempts left', battle.attemptsLeft],
          ['Attempts used', battle.attemptsUsed]
        ])
      ).update(campaign.battles)
    })
  ).update(apiData.progress.campaigns)
  root.append(node(document, 'h3', 'Legendary events'), events)
  pager(document, events, 'Legendary events', (event) => {
    const article = node(document, 'article')
    article.append(
      node(document, 'h4', event.id),
      fields(document, [
        ['Current points', event.currentPoints],
        ['Current currency', event.currentCurrency],
        ['Current shards', event.currentShards],
        ['Claimed chest index', event.currentClaimedChestIndex],
        ['Returned lanes', event.lanes.length],
        ['Current run', event.currentEvent?.run],
        [
          'Extra currency per payout',
          event.currentEvent?.extraCurrencyPerPayout
        ],
        [
          'Extra token ad used today at snapshot',
          event.currentEvent?.hasUsedAdForExtraTokenToday
        ]
      ])
    )
    return article
  }).update(apiData.progress.legendaryEvents)
}

// Only the already projected Player API fields enter these cached feature views.
// This module performs no network requests or persistent browser writes.
export function mountCachedPlayerFeatures(document) {
  const roster = { query: '', alliance: '', sort: 'name' },
    inventory = { query: '', category: '' }
  return {
    update(apiData) {
      rosterView(
        document,
        document.querySelector('#roster-feature'),
        apiData,
        roster
      )
      resourcesView(
        document,
        document.querySelector('#resource-feature'),
        apiData,
        inventory
      )
      progressView(
        document,
        document.querySelector('#progress-feature'),
        apiData
      )
    }
  }
}
