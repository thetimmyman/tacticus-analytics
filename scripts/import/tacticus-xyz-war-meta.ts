#!/usr/bin/env tsx

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { config as loadEnv } from 'dotenv'
import {
  discoverTacticusXyzWarMetaDimensions,
  parseTacticusXyzCoresPage,
  parseTacticusXyzLineupsPage,
  type ExternalCoreRow,
  type ExternalLineupRow,
  type QuarantinedWarMetaRow,
  type WarMetaMetric,
  type WarMetaSide
} from '../../app/lib/war-meta/tacticus-xyz-parser'

loadEnv({ path: resolve(process.cwd(), '.env.local'), override: false })
loadEnv({ path: resolve(process.cwd(), '.env'), override: false })

const SOURCE = 'tacticus.xyz'
const SOURCE_BASE = 'https://tacticus.xyz'
const REQUEST_DELAY_MS = 3_000
const REQUEST_TIMEOUT_MS = 60_000
const MAX_FETCH_ATTEMPTS = 8
const MAX_RETRY_DELAY_MS = 60_000
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_PAGES_PER_SLICE = 600
const USER_AGENT =
  'TacticusAnalyticsMetaArchive/1.0 (+https://tacticusanalytics.com/about; admin@tacticusanalytics.com)'

interface ImportOptions {
  checkpointPath: string
  dryRun: boolean
  seasons: number[] | null
  battlefieldLevels: number[] | null
}

interface Checkpoint {
  version: 1
  snapshotAt: string
  completed: Record<
    string,
    { checksum: string; rowCount: number; snapshotId: string | null }
  >
}

interface Slice {
  metric: WarMetaMetric
  side: WarMetaSide
  season: number
  battlefieldLevel: number
}

const sleep = (milliseconds: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

function parseIntegerList(value: string, label: string): number[] {
  const values = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Number.isInteger)
  if (values.length === 0) throw new Error(`${label} must contain integers`)
  return [...new Set(values)]
}

function parseArgs(argv: string[]): ImportOptions {
  let checkpointPath = ''
  let dryRun = false
  let seasons: number[] | null = null
  let battlefieldLevels: number[] | null = null

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--checkpoint') checkpointPath = argv[++index] ?? ''
    else if (arg === '--seasons') {
      seasons = parseIntegerList(argv[++index] ?? '', '--seasons')
    } else if (arg === '--battlefield-levels') {
      battlefieldLevels = parseIntegerList(
        argv[++index] ?? '',
        '--battlefield-levels'
      )
    } else if (arg === '--help') {
      console.log(`Usage:
  npm run import:war-meta:tacticus-xyz -- --checkpoint <scratch-path> [options]

Options:
  --dry-run                     Fetch and validate without writing to Supabase
  --seasons 25,26               Restrict the one-time import
  --battlefield-levels 4,5      Restrict battlefield levels
  --checkpoint <path>           Required resumable checkpoint outside the repo`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!checkpointPath) {
    throw new Error(
      '--checkpoint is required; use a path under ~/scratch/tacticus/global-war-meta/'
    )
  }
  return {
    checkpointPath: resolve(checkpointPath),
    dryRun,
    seasons,
    battlefieldLevels
  }
}

async function loadCheckpoint(path: string): Promise<Checkpoint> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Checkpoint
    if (parsed.version !== 1 || typeof parsed.completed !== 'object') {
      throw new Error('unsupported checkpoint shape')
    }
    parsed.snapshotAt ||= new Date().toISOString()
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { version: 1, snapshotAt: new Date().toISOString(), completed: {} }
  }
}

async function saveCheckpoint(path: string, checkpoint: Checkpoint) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
}

let lastRequestAt = 0
async function fetchHtml(url: URL): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const remainingDelay = REQUEST_DELAY_MS - (Date.now() - lastRequestAt)
    if (remainingDelay > 0) await sleep(remainingDelay)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let retryable = false
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: controller.signal
      })
      lastRequestAt = Date.now()
      if (response.ok) return await response.text()

      lastError = new Error(`GET ${url} failed with HTTP ${response.status}`)
      retryable = RETRYABLE_HTTP_STATUSES.has(response.status)
    } catch (error) {
      lastRequestAt = Date.now()
      lastError = error
      retryable = true
    } finally {
      clearTimeout(timeout)
    }

    if (!retryable || attempt === MAX_FETCH_ATTEMPTS) throw lastError

    const delayMs = Math.min(
      REQUEST_DELAY_MS * 2 ** (attempt - 1),
      MAX_RETRY_DELAY_MS
    )
    console.warn(
      JSON.stringify({
        event: 'source_retry',
        url: url.toString(),
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error:
          lastError instanceof Error ? lastError.message : String(lastError)
      })
    )
    await sleep(delayMs)
  }

  throw (
    lastError ??
    new Error(`GET ${url} failed without completing a fetch attempt`)
  )
}

function supabaseConfig() {
  const baseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!baseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), serviceKey }
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { baseUrl, serviceKey } = supabaseConfig()
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  if (!response.ok) {
    throw new Error(
      `Supabase ${path} failed with HTTP ${response.status}: ${await response.text()}`
    )
  }
  return (await response.json()) as T
}

async function loadKnownUnitIds(): Promise<Set<string>> {
  const rows = await supabaseRequest<Array<{ unit_id: string }>>(
    'hero_mappings?select=unit_id&unit_id=not.is.null'
  )
  const result = new Set(rows.map((row) => row.unit_id).filter(Boolean))
  if (result.size < 50) {
    throw new Error(
      `Known-unit registry is unexpectedly small (${result.size})`
    )
  }
  return result
}

function slicePath(slice: Slice): string {
  if (slice.metric === 'cores') {
    return slice.side === 'offense'
      ? '/wars/analyze/attackers'
      : '/wars/analyze/defenders'
  }
  return slice.side === 'offense'
    ? '/wars/top/attackers/lineups'
    : '/wars/top/defenders/lineups'
}

function sliceUrl(slice: Slice, page = 1): URL {
  const url = new URL(slicePath(slice), SOURCE_BASE)
  url.searchParams.append('season[]', String(slice.season))
  url.searchParams.append('battlefield[]', String(slice.battlefieldLevel))
  if (page > 1) url.searchParams.set('page', String(page))
  return url
}

function sliceKey(slice: Slice): string {
  return [
    slice.metric,
    slice.side,
    `s${slice.season}`,
    `b${slice.battlefieldLevel}`
  ].join(':')
}

function stableChecksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function collapseExactDuplicateKeys(
  rows: Array<ExternalLineupRow | ExternalCoreRow>,
  keyName: 'lineup_key' | 'core_key'
): Array<ExternalLineupRow | ExternalCoreRow> {
  const unique = new Map<string, ExternalLineupRow | ExternalCoreRow>()
  for (const row of rows) {
    const key =
      keyName === 'lineup_key'
        ? (row as ExternalLineupRow).lineup_key
        : (row as ExternalCoreRow).core_key
    const existing = unique.get(key)
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
      throw new Error(`Conflicting duplicate ${keyName} ${key}`)
    }
    unique.set(key, row)
  }
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row)
}

async function collectSlice(
  slice: Slice,
  knownUnitIds: ReadonlySet<string>
): Promise<{
  rows: Array<ExternalLineupRow | ExternalCoreRow>
  quarantinedRows: QuarantinedWarMetaRow[]
  pageCount: number
  sourceUrl: string
  duplicateRows: number
}> {
  const firstUrl = sliceUrl(slice)
  const firstHtml = await fetchHtml(firstUrl)
  const parse = (html: string) =>
    slice.metric === 'lineups'
      ? parseTacticusXyzLineupsPage(html, knownUnitIds)
      : parseTacticusXyzCoresPage(html, slice.side, knownUnitIds)
  const first = parse(firstHtml)
  if (first.totalPages > MAX_PAGES_PER_SLICE) {
    throw new Error(
      `${sliceKey(slice)} exposes ${first.totalPages} pages; cap is ${MAX_PAGES_PER_SLICE}`
    )
  }

  const rows: Array<ExternalLineupRow | ExternalCoreRow> = [...first.rows]
  const quarantinedRows = [...first.quarantinedRows]
  for (let page = 2; page <= first.totalPages; page++) {
    const parsed = parse(await fetchHtml(sliceUrl(slice, page)))
    rows.push(...parsed.rows)
    quarantinedRows.push(...parsed.quarantinedRows)
  }

  const observedRows = rows.length + quarantinedRows.length
  if (
    slice.metric === 'lineups' &&
    first.totalEntries > 0 &&
    observedRows !== first.totalEntries
  ) {
    throw new Error(
      `${sliceKey(slice)} expected ${first.totalEntries} rows, parsed ${observedRows}`
    )
  }
  const uniqueRows = collapseExactDuplicateKeys(
    rows,
    slice.metric === 'lineups' ? 'lineup_key' : 'core_key'
  )
  return {
    rows: uniqueRows,
    quarantinedRows,
    pageCount: first.totalPages,
    sourceUrl: firstUrl.toString(),
    duplicateRows: rows.length - uniqueRows.length
  }
}

async function importSlice(
  slice: Slice,
  collected: Awaited<ReturnType<typeof collectSlice>>,
  snapshotAt: string,
  checksum: string
): Promise<string> {
  return supabaseRequest<string>('rpc/import_external_war_meta_slice', {
    method: 'POST',
    body: JSON.stringify({
      p_source: SOURCE,
      p_metric_type: slice.metric,
      p_side: slice.side,
      p_season: slice.season,
      p_battlefield_level: slice.battlefieldLevel,
      p_snapshot_at: snapshotAt,
      p_source_url: collected.sourceUrl,
      p_page_count: collected.pageCount,
      p_checksum: checksum,
      p_rows: collected.rows,
      p_quarantined_rows: collected.quarantinedRows
    })
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const checkpoint = await loadCheckpoint(options.checkpointPath)
  const snapshotAt = checkpoint.snapshotAt
  const knownUnitIds = await loadKnownUnitIds()

  const discoveryHtml = await fetchHtml(
    new URL('/wars/analyze/attackers', SOURCE_BASE)
  )
  const discovered = discoverTacticusXyzWarMetaDimensions(discoveryHtml)
  const seasons = options.seasons ?? discovered.seasons
  const battlefieldLevels =
    options.battlefieldLevels ?? discovered.battlefieldLevels
  const slices: Slice[] = []
  for (const season of seasons) {
    for (const battlefieldLevel of battlefieldLevels) {
      for (const metric of ['cores', 'lineups'] as const) {
        for (const side of ['offense', 'defense'] as const) {
          slices.push({ metric, side, season, battlefieldLevel })
        }
      }
    }
  }

  console.log(
    JSON.stringify({
      event: 'archive_start',
      source: SOURCE,
      snapshotAt,
      slices: slices.length,
      seasons,
      battlefieldLevels,
      knownUnits: knownUnitIds.size,
      dryRun: options.dryRun
    })
  )

  let requestsBefore = lastRequestAt
  let completed = 0
  for (const slice of slices) {
    const key = sliceKey(slice)
    if (checkpoint.completed[key]) {
      completed++
      console.log(JSON.stringify({ event: 'slice_skip', key }))
      continue
    }

    const collected = await collectSlice(slice, knownUnitIds)
    const checksum = stableChecksum({
      slice,
      rows: collected.rows,
      quarantinedRows: collected.quarantinedRows
    })
    const snapshotId = options.dryRun
      ? null
      : await importSlice(slice, collected, snapshotAt, checksum)
    if (!options.dryRun) {
      checkpoint.completed[key] = {
        checksum,
        rowCount: collected.rows.length,
        snapshotId
      }
      await saveCheckpoint(options.checkpointPath, checkpoint)
    }
    completed++
    console.log(
      JSON.stringify({
        event: 'slice_complete',
        key,
        completed,
        total: slices.length,
        pages: collected.pageCount,
        rows: collected.rows.length,
        duplicateRows: collected.duplicateRows,
        quarantined: collected.quarantinedRows.length,
        snapshotId
      })
    )
  }

  console.log(
    JSON.stringify({
      event: 'archive_complete',
      completed,
      total: slices.length,
      checkpoint: options.checkpointPath,
      madeRequests: lastRequestAt !== requestsBefore
    })
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
