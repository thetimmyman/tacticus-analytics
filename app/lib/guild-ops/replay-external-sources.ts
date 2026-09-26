/** Runs under bare `tsx` without `npm ci`: no npm packages, `@/` aliases or JSON imports. */

export const TERMINUS_REPLAY_LIBRARY_URL =
  'https://terminusmaximus.com/replay-library/'

export const EXTERNAL_SNAPSHOT_USER_AGENT =
  // Sent to third-party sites: never include a live login identity.
  'tacticus-analytics-replay-snapshot/1.0 (+https://tacticusanalytics.com)'

export type ExternalSourceSystem = 'terminus-maximus'

export interface TerminusReplayRecord {
  id?: string
  boss: string
  bossLongName?: string
  team: string
  map: string
  tier: string
  damage: number
  damageLabel?: string
  heroes: string[]
  mow?: string | null
  creator?: string | null
  videoUrl: string
  publishedAt?: string
  publishedAtLabel?: string
  publishedAtTimestamp?: number
}

export interface TerminusReplayLibrary {
  replays: TerminusReplayRecord[]
  bosses?: Array<{ value: string; label: string }>
  mapsByBoss?: Record<string, string[]>
  teams?: string[]
  tiers?: string[]
  heroesByTeam?: Record<string, string[]>
  archivedReplayCount?: number
}

const TERMINUS_DATA_MARKER = 'const replayLibraryData = '

/** Throws on layout change so the snapshot script keeps the committed snapshot. */
export function extractTerminusReplayLibrary(
  html: string
): TerminusReplayLibrary {
  const markerIndex = html.indexOf(TERMINUS_DATA_MARKER)
  if (markerIndex < 0) {
    throw new Error(
      'replayLibraryData marker not found — terminusmaximus.com page layout changed?'
    )
  }
  const start = html.indexOf('{', markerIndex + TERMINUS_DATA_MARKER.length)
  if (start < 0) {
    throw new Error(
      'replayLibraryData marker found but no object literal follows'
    )
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const parsed = JSON.parse(html.slice(start, i + 1)) as unknown
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !Array.isArray((parsed as TerminusReplayLibrary).replays)
        ) {
          throw new Error('replayLibraryData parsed but has no replays array')
        }
        return parsed as TerminusReplayLibrary
      }
    }
  }
  throw new Error(
    'replayLibraryData object literal never balanced — truncated page?'
  )
}

// Tyranid variants resolve via the season lineup.
const TERMINUS_BOSS_TO_PLAYBOOK: Record<string, string> = {
  avatar: 'avatar-of-khaine',
  cawl: 'belisarius',
  dorn: 'rogal-dorn',
  ghaz: 'ghazghkull',
  lion: 'lion',
  magnus: 'magnus',
  mortarion: 'mortarion',
  riptide: 'riptide',
  screamer: 'screamer-killer',
  szarekh: 'silent-king'
}

const TERMINUS_TYRANID_GENUS: Record<string, 'hive-tyrant' | 'tervigon'> = {
  hivetyrant: 'hive-tyrant',
  tervigon: 'tervigon'
}

const TERMINUS_TEAM_TO_META_TEAM: Record<string, string> = {
  admech: 'Admech',
  battlesuits: 'Battlesuits',
  custodes: 'Custodes',
  forcasmo: 'Forcasmo',
  laviscus: 'Lavstodes',
  neuro: "Neuro / Z'Kar"
}

// Mirrors BOSS_TYPE_TO_PLAYBOOK_ID in replay-board-catalog.ts; a unit test checks alignment.
const BOSS_TYPE_TO_PLAYBOOK_ID: Record<string, string> = {
  avatarofkhaine: 'avatar-of-khaine',
  belisariusrw: 'belisarius',
  belisarius: 'belisarius',
  ghazghkull: 'ghazghkull',
  hivetyrantgorgon: 'hive-tyrant-gorgon',
  hivetyrantkronos: 'hive-tyrant-kronos',
  hivetyrantleviathan: 'hive-tyrant-leviathan',
  lion: 'lion',
  magnus: 'magnus',
  mortarion: 'mortarion',
  riptide: 'riptide',
  rogaldorn: 'rogal-dorn',
  screamerkiller: 'screamer-killer',
  silentking: 'silent-king',
  tervigongorgon: 'tervigon-gorgon',
  tervigonkronos: 'tervigon-kronos',
  tervigonleviathan: 'tervigon-leviathan'
}

// Dependency-free, so safe for standalone tsx.
import { stripNonAlnumLower } from '../resolvers/boss-identity'

const normalizeVocabKey = (value: string | null | undefined): string =>
  stripNonAlnumLower(value)

export interface SeasonWindowConfig {
  firstSeasonStartMs: number
  seasonDurationMs: number
  // Subtract before dividing by seasonDurationMs, or the season number advances a day early.
  seasonGapMs: number
  // Mirrors SEASON_NUMBER_OFFSET in season-configs.ts; a unit test asserts they agree.
  seasonNumberOffset: number
}

const EXTERNAL_SEASON_NUMBER_OFFSET = 10

const DEFAULT_SEASON_GAP_SECONDS = 86_400

export interface SeasonBossEncounter {
  set: number
  rarityIndex: number
  encounterType: string
  bossType: string
  boardId: string
}

export interface ExternalNormalizationContext {
  boardsByBoss: Record<string, string[]>
  seasonEncounters: Record<string, SeasonBossEncounter[]>
  seasonWindow: SeasonWindowConfig | null
}

interface PlaybookManifestLike {
  bosses: Array<{ id: string; boards?: string[] }>
}

interface SeasonLineupsLike {
  seasons?: Record<
    string,
    {
      encounters?: Array<{
        set?: number
        rarityIndex?: number
        encounterType?: string
        bossType?: string
        boardId?: string
      }>
    }
  >
}

interface GlobalConfigLike {
  guildBoss?: {
    misc?: {
      firstSeasonStart?: number
      seasonDuration?: number
      bufferAfterSeasonEnd?: number
      [key: string]: unknown
    }
  }
}

export function buildExternalNormalizationContext(input: {
  playbooks: PlaybookManifestLike
  seasonLineups?: SeasonLineupsLike | null
  globalConfig?: GlobalConfigLike | null
}): ExternalNormalizationContext {
  const boards = new Map<string, Set<string>>()
  for (const boss of input.playbooks.bosses) {
    boards.set(boss.id, new Set(boss.boards ?? []))
  }

  const seasonEncounters: Record<string, SeasonBossEncounter[]> = {}
  for (const [season, lineup] of Object.entries(
    input.seasonLineups?.seasons ?? {}
  )) {
    const encounters: SeasonBossEncounter[] = []
    for (const encounter of lineup.encounters ?? []) {
      if (
        typeof encounter.set !== 'number' ||
        typeof encounter.rarityIndex !== 'number' ||
        !encounter.bossType ||
        !encounter.boardId
      ) {
        continue
      }
      encounters.push({
        set: encounter.set,
        rarityIndex: encounter.rarityIndex,
        encounterType: encounter.encounterType ?? '',
        bossType: encounter.bossType,
        boardId: encounter.boardId
      })
      const playbookId =
        BOSS_TYPE_TO_PLAYBOOK_ID[normalizeVocabKey(encounter.bossType)]
      if (playbookId) {
        const set = boards.get(playbookId) ?? new Set<string>()
        set.add(encounter.boardId)
        boards.set(playbookId, set)
      }
    }
    seasonEncounters[season] = encounters
  }

  const misc = input.globalConfig?.guildBoss?.misc
  const seasonGapSeconds =
    typeof misc?.bufferAfterSeasonEnd === 'number' &&
    Number.isFinite(misc.bufferAfterSeasonEnd) &&
    misc.bufferAfterSeasonEnd >= 0
      ? misc.bufferAfterSeasonEnd
      : DEFAULT_SEASON_GAP_SECONDS
  const seasonWindow: SeasonWindowConfig | null =
    typeof misc?.firstSeasonStart === 'number' &&
    typeof misc?.seasonDuration === 'number' &&
    misc.firstSeasonStart > 0 &&
    misc.seasonDuration > 0
      ? {
          firstSeasonStartMs: misc.firstSeasonStart,
          seasonDurationMs: misc.seasonDuration * 1000,
          seasonGapMs: seasonGapSeconds * 1000,
          seasonNumberOffset: EXTERNAL_SEASON_NUMBER_OFFSET
        }
      : null

  return {
    boardsByBoss: Object.fromEntries(
      [...boards.entries()].map(([bossId, set]) => [bossId, [...set].sort()])
    ),
    seasonEncounters,
    seasonWindow
  }
}

/** Same window math as getSeasonPosition (season-configs.ts). */
export function inferSeasonNumber(
  referenceMs: number,
  window: SeasonWindowConfig | null
): number | null {
  if (!window || !Number.isFinite(referenceMs)) return null
  if (referenceMs < window.firstSeasonStartMs) return null
  const elapsedMs = Math.max(
    0,
    referenceMs - window.firstSeasonStartMs - window.seasonGapMs
  )
  const elapsed = Math.floor(elapsedMs / window.seasonDurationMs)
  return elapsed + 1 - window.seasonNumberOffset
}

const TIER_PATTERN = /^([LM])([1-5])$/

export function tierToLineupCoordinates(
  tier: string
): { set: number; rarityIndex: number } | null {
  const match = TIER_PATTERN.exec(tier.trim().toUpperCase())
  if (!match) return null
  const setNumber = Number(match[2])
  return {
    set: setNumber - 1,
    rarityIndex: match[1] === 'L' ? 4 : 5
  }
}

export function lineupBossEncounter(
  ctx: ExternalNormalizationContext,
  season: number,
  tier: string
): SeasonBossEncounter | null {
  const coordinates = tierToLineupCoordinates(tier)
  if (!coordinates) return null
  const encounters = ctx.seasonEncounters[String(season)]
  if (!encounters) return null
  return (
    encounters.find(
      (encounter) =>
        encounter.encounterType === 'Boss' &&
        encounter.set === coordinates.set &&
        encounter.rarityIndex === coordinates.rarityIndex
    ) ?? null
  )
}

// Mirrors boardMapNumber / roleForBoardId in replay-board-catalog.ts.
const boardNumber = (boardId: string): string => {
  const match = /(?:^|_)(\d{1,2})(?:_\d+)?$/.exec(boardId)
  return match ? match[1]!.padStart(2, '0') : ''
}

const isSupportBoard = (boardId: string): boolean =>
  /(?:^|_)support_/i.test(boardId)

function resolveBoardCandidates(
  ctx: ExternalNormalizationContext,
  bossId: string,
  mapNumber: string
): string[] {
  const padded = mapNumber.padStart(2, '0')
  return (ctx.boardsByBoss[bossId] ?? [])
    .filter((board) => !isSupportBoard(board) && boardNumber(board) === padded)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
}

export interface ExternalReplayCandidate {
  sourceSystem: ExternalSourceSystem
  externalVideoId: string | null
  videoUrl: string
  title: string
  bossId: string | null
  boardId: string | null
  mapNumber: string | null
  tier: string | null
  damage: number | null
  units: string[]
  metaTeamName: string | null
  creator: string | null
  publishedAt: string | null
  season: string | null
  encounterRole: 'boss'
  parseFlags: { missing: string[] }
}

export function extractYouTubeVideoId(
  url: string | null | undefined
): string | null {
  if (!url) return null
  const match = url.match(
    /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/
  )
  return match?.[1] ?? null
}

const terminusBossGenus = (boss: string): 'hive-tyrant' | 'tervigon' | null =>
  TERMINUS_TYRANID_GENUS[normalizeVocabKey(boss)] ?? null

const bossTypeMatchesTerminusBoss = (
  bossType: string,
  terminusBoss: string
): boolean => {
  const playbookId = BOSS_TYPE_TO_PLAYBOOK_ID[normalizeVocabKey(bossType)]
  if (!playbookId) return false
  const genus = terminusBossGenus(terminusBoss)
  if (genus) return playbookId.startsWith(genus)
  return (
    TERMINUS_BOSS_TO_PLAYBOOK[normalizeVocabKey(terminusBoss)] === playbookId
  )
}

// Dependency-free, so safe for standalone tsx.
import {
  isKnownHeroNickname,
  isKnownMachineOfWarNickname,
  resolveHeroNickname,
  resolveMachineOfWarNickname
} from '../catalogs/hero-nicknames'

export function normalizeTerminusReplay(
  record: TerminusReplayRecord,
  ctx: ExternalNormalizationContext
): ExternalReplayCandidate {
  const missing: string[] = []

  const videoUrl = (record.videoUrl ?? '').trim()
  const externalVideoId = extractYouTubeVideoId(videoUrl)
  if (!externalVideoId) missing.push('video-id')

  const tier = TIER_PATTERN.test((record.tier ?? '').trim().toUpperCase())
    ? record.tier.trim().toUpperCase()
    : null
  if (!tier) missing.push('tier')

  const publishedMs =
    typeof record.publishedAtTimestamp === 'number' &&
    Number.isFinite(record.publishedAtTimestamp)
      ? record.publishedAtTimestamp
      : record.publishedAt
        ? Date.parse(record.publishedAt)
        : Number.NaN
  const publishedAt = Number.isFinite(publishedMs)
    ? new Date(publishedMs).toISOString()
    : null
  if (!publishedAt) missing.push('published-at')

  // Videos published just after rollover cover the PRIOR season, so check the lineup;
  // if neither season matches, keep the inference and flag it.
  const inferredSeason = Number.isFinite(publishedMs)
    ? inferSeasonNumber(publishedMs, ctx.seasonWindow)
    : null
  let season = inferredSeason
  let matchedEncounter: SeasonBossEncounter | null = null
  if (inferredSeason !== null && tier) {
    const inferredEncounter = lineupBossEncounter(ctx, inferredSeason, tier)
    if (inferredEncounter) {
      if (
        bossTypeMatchesTerminusBoss(inferredEncounter.bossType, record.boss)
      ) {
        matchedEncounter = inferredEncounter
      } else {
        const priorEncounter = lineupBossEncounter(
          ctx,
          inferredSeason - 1,
          tier
        )
        if (
          priorEncounter &&
          bossTypeMatchesTerminusBoss(priorEncounter.bossType, record.boss)
        ) {
          season = inferredSeason - 1
          matchedEncounter = priorEncounter
        } else {
          missing.push('season-unverified')
        }
      }
    }
  }
  if (season === null) missing.push('season')

  // Tyranid variant is only knowable from the lineup; accept the season's single variant of the genus.
  const genus = terminusBossGenus(record.boss)
  let bossId: string | null = null
  if (genus) {
    if (matchedEncounter) {
      const resolved =
        BOSS_TYPE_TO_PLAYBOOK_ID[normalizeVocabKey(matchedEncounter.bossType)]
      bossId = resolved?.startsWith(genus) ? resolved : null
    }
    if (!bossId && season !== null) {
      const variants = new Set(
        (ctx.seasonEncounters[String(season)] ?? [])
          .filter((encounter) => encounter.encounterType === 'Boss')
          .map(
            (encounter) =>
              BOSS_TYPE_TO_PLAYBOOK_ID[normalizeVocabKey(encounter.bossType)]
          )
          .filter((resolved): resolved is string =>
            Boolean(resolved?.startsWith(genus))
          )
      )
      if (variants.size === 1) bossId = [...variants][0]!
    }
    if (!bossId) missing.push('boss-variant')
  } else {
    bossId = TERMINUS_BOSS_TO_PLAYBOOK[normalizeVocabKey(record.boss)] ?? null
    if (!bossId) missing.push('boss')
  }

  const mapNumberMatch = /(\d{1,2})\s*$/.exec(record.map ?? '')
  const mapNumber = mapNumberMatch ? mapNumberMatch[1]!.padStart(2, '0') : null
  if (!mapNumber) missing.push('map')

  let boardId: string | null = null
  if (bossId && mapNumber) {
    const candidates = resolveBoardCandidates(ctx, bossId, mapNumber)
    if (
      matchedEncounter &&
      candidates.includes(matchedEncounter.boardId) &&
      boardNumber(matchedEncounter.boardId) === mapNumber
    ) {
      boardId = matchedEncounter.boardId
    } else {
      boardId = candidates[0] ?? null
    }
    if (!boardId) missing.push('board')
  }

  const damage =
    typeof record.damage === 'number' &&
    Number.isFinite(record.damage) &&
    record.damage > 0
      ? Math.round(record.damage)
      : null
  if (damage === null) missing.push('damage')

  const units: string[] = []
  for (const hero of record.heroes ?? []) {
    if (!hero || !hero.trim()) continue
    if (!isKnownHeroNickname(hero)) missing.push(`hero:${hero}`)
    units.push(resolveHeroNickname(hero))
  }
  if (units.length === 0) missing.push('heroes')
  const mow = (record.mow ?? '').trim()
  if (mow) {
    if (!isKnownMachineOfWarNickname(mow)) missing.push(`mow:${mow}`)
    units.push(resolveMachineOfWarNickname(mow))
  }

  const metaTeamName =
    TERMINUS_TEAM_TO_META_TEAM[normalizeVocabKey(record.team)] ?? null
  if (!metaTeamName) missing.push('team')

  const bossLabel = (
    record.bossLongName ||
    record.boss ||
    'Unknown Boss'
  ).trim()
  const title = [
    bossLabel,
    mapNumber ? `Map ${mapNumber}` : null,
    metaTeamName ?? record.team ?? null
  ]
    .filter(Boolean)
    .join(' – ')
    .concat(tier ? ` | ${tier}` : '')
    .concat(mow ? ` – ${resolveMachineOfWarNickname(mow)}` : '')

  return {
    sourceSystem: 'terminus-maximus',
    externalVideoId,
    videoUrl,
    title,
    bossId,
    boardId,
    mapNumber,
    tier,
    damage,
    units,
    metaTeamName,
    creator: record.creator?.trim() || null,
    publishedAt,
    season: season !== null ? String(season) : null,
    encounterRole: 'boss',
    parseFlags: { missing }
  }
}

/** Anything failing this is unpublishable, not a review task. */
export function isPublishReadyCandidate(
  candidate: ExternalReplayCandidate
): boolean {
  return Boolean(
    candidate.externalVideoId && candidate.bossId && candidate.title
  )
}

export function buildExternalPublishTags(
  sourceSystem: ExternalSourceSystem,
  encounterRole: 'boss' | 'prime'
): string[] {
  return [sourceSystem, encounterRole, `encounter:${encounterRole}`]
}

export interface ReplayTitleHeuristics {
  tier: string | null
  damage: number | null
  bossWord: string | null
  mapNumber: string | null
  metaTeamName: string | null
}

const TITLE_BOSS_WORDS: Array<{ pattern: RegExp; boss: string }> = [
  { pattern: /silent\s*king|szarekh/i, boss: 'Szarekh' },
  { pattern: /cawl|belisarius/i, boss: 'Cawl' },
  { pattern: /ghaz/i, boss: 'Ghaz' },
  { pattern: /rogal|dorn/i, boss: 'Dorn' },
  { pattern: /avatar|khaine/i, boss: 'Avatar' },
  { pattern: /lion/i, boss: 'Lion' },
  { pattern: /magnus/i, boss: 'Magnus' },
  { pattern: /mortarion|morty/i, boss: 'Mortarion' },
  { pattern: /riptide/i, boss: 'Riptide' },
  { pattern: /screamer/i, boss: 'Screamer' },
  { pattern: /hive\s*tyrant/i, boss: 'Hive Tyrant' },
  { pattern: /tervigon/i, boss: 'Tervigon' }
]

const TITLE_TEAM_WORDS: Array<{ pattern: RegExp; team: string }> = [
  { pattern: /lavstodes|laviscus/i, team: 'Lavstodes' },
  { pattern: /custodes/i, team: 'Custodes' },
  { pattern: /ad\s*mech/i, team: 'Admech' },
  { pattern: /battle\s*suits?/i, team: 'Battlesuits' },
  { pattern: /forcasmo/i, team: 'Forcasmo' },
  { pattern: /neuro|z'?kar/i, team: "Neuro / Z'Kar" },
  { pattern: /double\s*howl/i, team: 'Double Howl' },
  { pattern: /\borkz?\b/i, team: 'Orkz' }
]

export function parseReplayTitleHeuristics(
  title: string
): ReplayTitleHeuristics {
  const tierMatch = /\b([LM][1-5])\b/i.exec(title)
  const tier = tierMatch ? tierMatch[1]!.toUpperCase() : null

  let damage: number | null = null
  const shorthand = /(\d+(?:[.,]\d+)?)\s*([mk])\b/i.exec(title)
  if (shorthand) {
    const value = Number(shorthand[1]!.replace(',', '.'))
    if (Number.isFinite(value)) {
      damage = Math.round(
        value * (shorthand[2]!.toLowerCase() === 'm' ? 1_000_000 : 1_000)
      )
    }
  } else {
    const raw = /\b(\d{1,3}(?:,\d{3}){1,3})\b/.exec(title)
    if (raw) {
      const value = Number(raw[1]!.replace(/,/g, ''))
      if (Number.isFinite(value) && value >= 100_000) damage = value
    }
  }

  const bossWord =
    TITLE_BOSS_WORDS.find(({ pattern }) => pattern.test(title))?.boss ?? null
  const mapMatch = /map\s*0?(\d{1,2})/i.exec(title)
  const mapNumber = mapMatch ? mapMatch[1]!.padStart(2, '0') : null
  const metaTeamName =
    TITLE_TEAM_WORDS.find(({ pattern }) => pattern.test(title))?.team ?? null

  return { tier, damage, bossWord, mapNumber, metaTeamName }
}
