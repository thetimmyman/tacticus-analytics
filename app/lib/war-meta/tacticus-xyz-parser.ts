export type WarMetaSide = 'offense' | 'defense'
export type WarMetaMetric = 'cores' | 'lineups'

export interface ExternalLineupRow {
  lineup_key: string
  unit_ids: string[]
  uses: number
  wins: number
  losses: number
  win_rate: number
  avg_score: number | null
}

export interface ExternalCoreFlexRow {
  heroKey: string
  uses: number
  wins: number
  winRate: number
}

export interface ExternalCoreRow {
  core_key: string
  unit_ids: string[]
  uses: number
  wins: number
  win_rate: number
  flex_options: ExternalCoreFlexRow[]
}

export interface QuarantinedWarMetaRow {
  unknown_unit_ids: string[]
  raw_row: unknown
}

export interface ParsedWarMetaPage<T> {
  rows: T[]
  quarantinedRows: QuarantinedWarMetaRow[]
  page: number
  totalPages: number
  totalEntries: number
}

const decodeHtml = (value: string): string =>
  value
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replaceAll('&amp;', '&')

const textContent = (html: string): string =>
  decodeHtml(
    html
      .replace(/<!--([\s\S]*?)-->/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )

const parseInteger = (value: string, label: string): number => {
  const normalized = value.replaceAll(',', '').trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return Number(normalized)
}

const parseDecimal = (value: string, label: string): number => {
  const normalized = value.replaceAll('%', '').replaceAll(',', '').trim()
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

const validateRate = (rate: number, label: string): void => {
  if (rate < 0 || rate > 100) {
    throw new Error(`${label} outside [0,100]: ${rate}`)
  }
}

const validateCounts = (uses: number, wins: number, losses?: number): void => {
  if (uses < 0 || wins < 0 || wins > uses) {
    throw new Error(`Invalid counts: uses=${uses}, wins=${wins}`)
  }
  if (losses !== undefined && (losses < 0 || wins + losses !== uses)) {
    throw new Error(
      `Invalid counts: uses=${uses}, wins=${wins}, losses=${losses}`
    )
  }
}

const parsePageMetadata = (
  html: string
): {
  page: number
  totalPages: number
  totalEntries: number
} => {
  const decodedHtml = decodeHtml(html)
  const pageValues = Array.from(
    decodedHtml.matchAll(/[?&]page=(\d+)/g),
    (match) => Number(match[1])
  )
  const page = Number(html.match(/name="page"[^>]*value="(\d+)"/)?.[1] ?? 1)
  const totalPages = Math.max(page, 1, ...pageValues)
  const totalEntriesMatch = html.match(
    /of\s*<span[^>]*>([\d,]+)<\/span>\s*total entries/i
  )
  const totalEntries = totalEntriesMatch
    ? parseInteger(totalEntriesMatch[1] ?? '', 'total entries')
    : 0
  return { page, totalPages, totalEntries }
}

const tableRows = (html: string, rowClass: string): string[] => {
  const escapedClass = rowClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rowPattern = new RegExp(
    `<tr[^>]*class="[^"]*${escapedClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/tr>`,
    'g'
  )
  return Array.from(html.matchAll(rowPattern), (match) => match[1] ?? '')
}

const cellTexts = (rowHtml: string): string[] =>
  Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), (match) =>
    textContent(match[1] ?? '')
  )

const imageAltValues = (html: string): string[] =>
  Array.from(html.matchAll(/\balt="([^"]+)"/g), (match) =>
    decodeHtml(match[1] ?? '')
  )

const partitionKnownUnits = (
  unitIds: string[],
  knownUnitIds: ReadonlySet<string>
): string[] => unitIds.filter((unitId) => !knownUnitIds.has(unitId))

export function discoverTacticusXyzWarMetaDimensions(html: string): {
  seasons: number[]
  battlefieldLevels: number[]
} {
  const extract = (name: string): number[] =>
    Array.from(
      html.matchAll(new RegExp(`name="${name}\\[\\]" value="(\\d+)"`, 'g')),
      (match) => Number(match[1])
    )

  const seasons = [...new Set(extract('season'))].sort((a, b) => b - a)
  const battlefieldLevels = [...new Set(extract('battlefield'))].sort(
    (a, b) => a - b
  )
  if (seasons.length === 0 || battlefieldLevels.length === 0) {
    throw new Error('tacticus.xyz filter dimensions were not found')
  }
  return { seasons, battlefieldLevels }
}

export function parseTacticusXyzLineupsPage(
  html: string,
  knownUnitIds: ReadonlySet<string>
): ParsedWarMetaPage<ExternalLineupRow> {
  const completeLineupTable = html.match(
    /<table\b[^>]*>[\s\S]*?<th\b[^>]*>\s*(?:Attacking|Defending) Team\s*<\/th>[\s\S]*?<tbody\b[^>]*>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/i
  )
  const lineupTableBody = completeLineupTable?.[1]
  const sourceRows = tableRows(lineupTableBody ?? html, 'flex-nowrap')
  const hasCompleteLineupTable =
    lineupTableBody !== undefined &&
    Array.from(lineupTableBody.matchAll(/<tr\b/gi)).length === sourceRows.length
  const hasCompleteLineupEmptyState =
    html.includes('No lineup data available for these filters yet.') &&
    html.includes('</html>')
  if (
    !html.includes('total entries') &&
    !html.includes('No lineups') &&
    !hasCompleteLineupTable &&
    !hasCompleteLineupEmptyState
  ) {
    throw new Error('tacticus.xyz lineup page shape is not recognized')
  }

  const rows: ExternalLineupRow[] = []
  const quarantinedRows: QuarantinedWarMetaRow[] = []
  for (const rowHtml of sourceRows) {
    const unitIds = [...new Set(imageAltValues(rowHtml))].sort()
    if (unitIds.length !== 5) {
      throw new Error(`Expected 5 lineup units, found ${unitIds.length}`)
    }
    const cells = cellTexts(rowHtml)
    if (cells.length < 7) {
      throw new Error(`Expected at least 7 lineup cells, found ${cells.length}`)
    }
    const uses = parseInteger(cells[1] ?? '', 'lineup uses')
    const wins = parseInteger(cells[2] ?? '', 'lineup wins')
    const losses = parseInteger(cells[3] ?? '', 'lineup losses')
    const winRate = parseDecimal(cells[4] ?? '', 'lineup win rate')
    const avgScoreText = cells[5] ?? ''
    const avgScore =
      avgScoreText === '' ? null : parseDecimal(avgScoreText, 'avg score')
    validateCounts(uses, wins, losses)
    validateRate(winRate, 'lineup win rate')

    const row: ExternalLineupRow = {
      lineup_key: unitIds.join('|'),
      unit_ids: unitIds,
      uses,
      wins,
      losses,
      win_rate: winRate,
      avg_score: avgScore
    }
    const unknownUnitIds = partitionKnownUnits(unitIds, knownUnitIds)
    if (unknownUnitIds.length > 0) {
      quarantinedRows.push({
        unknown_unit_ids: unknownUnitIds,
        raw_row: row
      })
    } else {
      rows.push(row)
    }
  }

  const metadata = parsePageMetadata(html)
  if (metadata.totalEntries === 0 && sourceRows.length > 0) {
    metadata.totalEntries = sourceRows.length
  }
  return { rows, quarantinedRows, ...metadata }
}

const parseFlexRows = (detailsHtml: string): ExternalCoreFlexRow[] => {
  const results: ExternalCoreFlexRow[] = []
  const pattern =
    /alt="([^"]+)"[\s\S]{0,1600}?Used\s*<span[^>]*>([\d,]+)<\/span>[\s\S]{0,800}?Wins\s*<span[^>]*>([\d,]+)<\/span>[\s\S]{0,800}?(?:Win|Def)[^<]*<span[^>]*>([\d.]+)%<\/span>/g
  for (const match of detailsHtml.matchAll(pattern)) {
    const uses = parseInteger(match[2] ?? '', 'flex uses')
    const wins = parseInteger(match[3] ?? '', 'flex wins')
    const winRate = parseDecimal(match[4] ?? '', 'flex win rate')
    validateCounts(uses, wins)
    validateRate(winRate, 'flex win rate')
    results.push({
      heroKey: decodeHtml(match[1] ?? ''),
      uses,
      wins,
      winRate
    })
  }
  return results
}

export function parseTacticusXyzCoresPage(
  html: string,
  side: WarMetaSide,
  knownUnitIds: ReadonlySet<string>
): ParsedWarMetaPage<ExternalCoreRow> {
  const core3EmptyText =
    side === 'offense'
      ? 'No core-3 data available yet.'
      : 'No defensive core-3 data available yet.'
  const hasCompleteCore3EmptyState =
    html.includes(core3EmptyText) && html.includes('</html>')
  if (
    !html.includes('data-core-key=') &&
    !html.includes('No cores') &&
    !hasCompleteCore3EmptyState
  ) {
    throw new Error('tacticus.xyz core page shape is not recognized')
  }

  const rows: ExternalCoreRow[] = []
  const quarantinedRows: QuarantinedWarMetaRow[] = []
  const mainRowPattern =
    /<tr[^>]*data-core-key="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g
  for (const match of html.matchAll(mainRowPattern)) {
    const unitIds = decodeHtml(match[1] ?? '')
      .split('|')
      .filter(Boolean)
      .sort()
    if (unitIds.length !== 3) {
      throw new Error(`Expected 3 core units, found ${unitIds.length}`)
    }
    const cells = cellTexts(match[2] ?? '')
    const numericCells = cells.slice(2)
    if (numericCells.length < 3) {
      throw new Error(
        `Expected core statistic cells, found ${numericCells.length}`
      )
    }
    const uses = parseInteger(numericCells[0] ?? '', 'core uses')
    const wins = parseInteger(numericCells[1] ?? '', 'core wins')
    const winRate = parseDecimal(numericCells[2] ?? '', 'core win rate')
    validateCounts(uses, wins)
    validateRate(winRate, 'core win rate')

    const coreKey = unitIds.join('|')
    const detailsStart = html.indexOf(
      `id="core-details-${coreKey}"`,
      match.index
    )
    const detailsEnd =
      detailsStart >= 0 ? html.indexOf('</tr>', detailsStart) : -1
    const flexOptions =
      detailsStart >= 0 && detailsEnd > detailsStart
        ? parseFlexRows(html.slice(detailsStart, detailsEnd))
        : []
    const row: ExternalCoreRow = {
      core_key: coreKey,
      unit_ids: unitIds,
      uses,
      wins,
      win_rate: winRate,
      flex_options: flexOptions
    }
    const unknownUnitIds = partitionKnownUnits(
      [...unitIds, ...flexOptions.map((flex) => flex.heroKey)],
      knownUnitIds
    )
    if (unknownUnitIds.length > 0) {
      quarantinedRows.push({
        unknown_unit_ids: [...new Set(unknownUnitIds)].sort(),
        raw_row: { ...row, side }
      })
    } else {
      rows.push(row)
    }
  }

  const metadata = parsePageMetadata(html)
  return {
    rows,
    quarantinedRows,
    page: metadata.page,
    totalPages: 1,
    totalEntries: rows.length + quarantinedRows.length
  }
}
