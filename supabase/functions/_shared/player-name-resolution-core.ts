// Pure name-resolution helpers (no Deno imports) for edge and vitest; the I/O lives in player-name-resolution.ts.

export type PlayerNameMap = Map<string, string>

export const isUidLikeName = (name: string): boolean => {
  if (!name) return true
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const playerHashPattern = /^Player#[A-F0-9]{6}$/i
  return uuidPattern.test(name) || playerHashPattern.test(name)
}

export const resolveDisplayName = (
  displayName: string | null | undefined,
  userId: string | null | undefined,
  playerNameMap: PlayerNameMap
): string => {
  if (!displayName) {
    if (userId && playerNameMap.has(userId)) {
      return playerNameMap.get(userId)!
    }
    if (userId && playerNameMap.has(userId.toLowerCase())) {
      return playerNameMap.get(userId.toLowerCase())!
    }
    const shortId =
      userId?.replace(/-/g, '').substring(0, 6).toUpperCase() || 'UNKNWN'
    return `Player#${shortId}`
  }
  if (!isUidLikeName(displayName)) {
    return displayName
  }
  if (userId && playerNameMap.has(userId)) {
    return playerNameMap.get(userId)!
  }
  if (userId && playerNameMap.has(userId.toLowerCase())) {
    return playerNameMap.get(userId.toLowerCase())!
  }
  if (displayName.startsWith('Player#')) {
    return displayName
  }
  const shortId =
    userId?.replace(/-/g, '').substring(0, 6).toUpperCase() || 'UNKNWN'
  return `Player#${shortId}`
}

/**
 * Erasure tombstone prefix in EOT_GR_data.displayName and player_mapping.display_name. Terminal: no
 * ingestion path may refresh it from upstream, or re-ingestion reverses the erasure.
 */
export const ERASURE_TOMBSTONE_PREFIX = '[DELETED_USER_'

export const isErasureTombstone = (
  name: string | null | undefined
): name is string =>
  typeof name === 'string' && name.startsWith(ERASURE_TOMBSTONE_PREFIX)

/** Privacy-safe alias; callers fail closed to it when erasure status is unreadable, never to a username. */
export const synthesizePlayerAlias = (userId: string): string =>
  `Player#${userId.replace(/-/g, '').substring(0, 6).toUpperCase() || 'UNKNWN'}`

// Departed members' names are a last-resort fallback; tombstones and uid-like placeholders never are,
// and only player_id -> display_name is ever read (no user_id, Discord or credentials).

/** The only player_mapping columns a name loader may select. */
export const PLAYER_NAME_ROW_COLUMNS = 'player_id, display_name, is_current'

export interface PlayerNameRow {
  player_id?: string | null
  display_name?: string | null
  is_current?: boolean | null
}

export interface PlayerNameIndex {
  /** Current rows only. */
  currentNames: Map<string, string>
  /** Players with no current row. */
  departedNames: Map<string, string>
  /** Membership, not names. */
  currentIds: Set<string>
}

export const buildPlayerNameIndex = (
  rows: ReadonlyArray<PlayerNameRow> | null | undefined,
  normalizeId: (playerId: string) => string = (playerId) => playerId
): PlayerNameIndex => {
  const currentNames = new Map<string, string>()
  const departedNames = new Map<string, string>()
  const currentIds = new Set<string>()
  const tombstoned = new Set<string>()

  for (const row of rows ?? []) {
    const rawId = typeof row.player_id === 'string' ? row.player_id.trim() : ''
    const name =
      typeof row.display_name === 'string' ? row.display_name.trim() : ''
    if (!rawId) continue
    const id = normalizeId(rawId)

    if (row.is_current === true) {
      currentIds.add(id)
      if (name && !currentNames.has(id)) currentNames.set(id, name)
      continue
    }
    if (isErasureTombstone(name)) {
      tombstoned.add(id)
      continue
    }
    if (!name || isUidLikeName(name)) continue
    if (!departedNames.has(id)) departedNames.set(id, name)
  }

  for (const id of [...departedNames.keys()]) {
    if (currentIds.has(id) || tombstoned.has(id)) departedNames.delete(id)
  }
  return { currentNames, departedNames, currentIds }
}

/** Precedence: current -> live (ignored when blank) -> departed -> fallback. */
export const pickPlayerName = (
  current: string | null | undefined,
  live: string | null | undefined,
  departed: string | null | undefined
): string | undefined => {
  if (typeof current === 'string' && current.trim()) return current
  if (typeof live === 'string' && live.trim()) return live
  if (typeof departed === 'string' && departed.trim()) return departed
  return undefined
}

// Keyset pagination: PostgREST caps rows per response, and a truncated page would silently drop names.

type PageResult = PromiseLike<{
  data: unknown[] | null
  error: { message?: string } | null
}>
/** Minimal structural client: `.from().select().order().gt().limit()`. */
export interface PlayerNamePageClient {
  from(table: 'player_mapping'): {
    select(columns: string): {
      order(
        column: 'id',
        options: { ascending: boolean }
      ): {
        gt(column: 'id', value: number): { limit(count: number): PageResult }
      }
    }
  }
}

const PLAYER_NAME_PAGE_SIZE = 5000
const PLAYER_NAME_MAX_PAGES = 20

export async function fetchPlayerNameMapPaged(
  client: PlayerNamePageClient,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<PlayerNameMap> {
  const pageSize = opts.pageSize ?? PLAYER_NAME_PAGE_SIZE
  const maxPages = opts.maxPages ?? PLAYER_NAME_MAX_PAGES
  const rows: PlayerNameRow[] = []
  let lastId = 0
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      throw new Error('loadPlayerNameMap: page limit exceeded')
    }
    const { data, error } = await client
      .from('player_mapping')
      .select(`id, ${PLAYER_NAME_ROW_COLUMNS}`)
      .order('id', { ascending: true })
      .gt('id', lastId)
      .limit(pageSize)
    // Never cache an empty map (everyone becomes Player# for the TTL); throw so the caller serves stale.
    if (error) {
      throw new Error(`loadPlayerNameMap: ${error.message ?? 'fetch failed'}`)
    }
    const batch = (data ?? []) as Array<PlayerNameRow & { id?: number }>
    rows.push(...batch)
    if (batch.length < pageSize) break
    const nextId = batch[batch.length - 1]?.id
    if (typeof nextId !== 'number' || nextId <= lastId) {
      throw new Error('loadPlayerNameMap: keyset page did not advance')
    }
    lastId = nextId
  }
  if (rows.length === 0) {
    throw new Error('loadPlayerNameMap: empty result from player_mapping')
  }

  const { currentNames, departedNames } = buildPlayerNameIndex(rows)
  const map: PlayerNameMap = new Map<string, string>()
  for (const source of [currentNames, departedNames]) {
    for (const [playerId, name] of source) {
      if (!map.has(playerId)) map.set(playerId, name)
    }
  }
  for (const source of [currentNames, departedNames]) {
    for (const [playerId, name] of source) {
      const lower = playerId.toLowerCase()
      if (!map.has(lower)) map.set(lower, name)
    }
  }
  return map
}

/** TTL cache with single-flight refresh and stale-on-error. */
export function createPlayerNameMapCache<C>(
  fetcher: (client: C) => Promise<PlayerNameMap>,
  opts: {
    ttlMs: number
    now?: () => number
    warn?: (message: string) => void
  }
): (client: C) => Promise<PlayerNameMap> {
  const now = opts.now ?? (() => Date.now())
  let cachedMap: PlayerNameMap | null = null
  let cachedAt = 0
  let inflight: Promise<PlayerNameMap> | null = null
  return (client: C) => {
    if (cachedMap && now() - cachedAt < opts.ttlMs) {
      return Promise.resolve(cachedMap)
    }
    if (inflight) return inflight
    inflight = fetcher(client)
      .then((map) => {
        cachedMap = map
        cachedAt = now()
        return map
      })
      .catch((err) => {
        if (cachedMap) {
          opts.warn?.(
            `[player-name-resolution] fetch failed, serving stale cache: ${err?.message ?? err}`
          )
          return cachedMap
        }
        throw err
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }
}

/** Gap-fills current names into `primary` without overwriting live names; returns departed names apart. */
export const seedSyncPlayerMappings = (
  rows: ReadonlyArray<PlayerNameRow> | null | undefined,
  primary: Record<string, string>
): Record<string, string> => {
  const { currentNames, departedNames } = buildPlayerNameIndex(rows)
  for (const [playerId, name] of currentNames) {
    if (!primary[playerId]) {
      primary[playerId] = name
      primary[playerId.toLowerCase()] = name
    }
  }
  const departed: Record<string, string> = {}
  for (const [playerId, name] of departedNames) {
    departed[playerId] = name
    departed[playerId.toLowerCase()] = name
  }
  return departed
}

/** Gap-fills tombstones into the primary map, so a tombstone always beats a departed name. */
export const seedErasureNames = (
  primary: Record<string, string>,
  tombstones: Record<string, string>,
  withheld: ReadonlyArray<string>
): void => {
  for (const [playerId, tombstone] of Object.entries(tombstones)) {
    if (!primary[playerId]) {
      primary[playerId] = tombstone
      primary[playerId.toLowerCase()] = tombstone
    }
  }
  for (const playerId of withheld) {
    if (!primary[playerId]) {
      const alias = synthesizePlayerAlias(playerId)
      primary[playerId] = alias
      primary[playerId.toLowerCase()] = alias
    }
  }
}
