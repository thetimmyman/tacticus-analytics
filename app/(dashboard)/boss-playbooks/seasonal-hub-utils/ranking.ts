import { resolveEncounterOps } from '@/app/lib/boss-ops/encounter-ops-merge'
import type { SeasonLineupEntry } from '@/app/lib/loki/season-configs'
import {
  encounterRoleToSide,
  normalizeEncounterRole
} from '@/app/lib/boss-playbooks/encounter-role'
import { canonicalGuildPinBossKey } from '@/app/lib/boss-playbooks/guild-pin-boss-key'
import type { PlaybooksData } from '../types'
import {
  GROUP_ORDER,
  RARITY_BY_INDEX,
  resolveSeasonalTargetToken,
  seasonalBattleMetricKey,
  seasonalMetaAtlasTeamKey,
  seasonalOpsKey,
  seasonalTargetTokenKey
} from './keys'
import {
  boardImageFallbackUrl,
  bossDisplayNameForEncounter,
  buildBossMappingLookup,
  buildPlaybookLookup,
  difficultyCodeFor,
  extractDifficultyCode,
  extractMapNumber,
  formatBoardLabel,
  normalizeBoard,
  normalizeKey,
  normalizeSeason,
  portraitLookupNameForEncounter,
  resolvePlaybook,
  tacticusTableUrlFor
} from './resolve'
import { metaAtlasBenchmarkDamage } from './types'
import type {
  SeasonalBossCardData,
  SeasonalBossHubData,
  SeasonalEncounterData,
  SeasonalHubBattleMetrics,
  SeasonalHubBossMappingRow,
  SeasonalHubHeraldConfig,
  SeasonalHubMetaAtlasTeam,
  SeasonalHubReplay,
  SeasonalHubReplayLinkMode,
  SeasonalHubReplayRow,
  SeasonalHubSeasonOps,
  SeasonalHubTargetToken
} from './types'

const replayEncounterRole = (
  replay: Pick<SeasonalHubReplayRow, 'tags' | 'title' | 'encounter_role'>
): 'main' | 'side' | null => {
  // `encounter_role` wins (editor changes must); tags/title are a fallback when it is empty.
  const col = normalizeEncounterRole(
    (replay as { encounter_role?: unknown }).encounter_role
  )
  if (col) return encounterRoleToSide(col)

  const tags = (replay.tags ?? []).map((tag) => tag.toLowerCase())
  if (
    tags.some((tag) =>
      ['sideboss', 'side-boss', 'side_boss', 'prime', 'support'].includes(tag)
    )
  ) {
    return 'side'
  }
  if (tags.some((tag) => ['boss', 'main', 'main-boss'].includes(tag))) {
    return 'main'
  }

  const title = replay.title?.toLowerCase() ?? ''
  if (/\b(side\s*boss|sideboss|prime|support)\b/.test(title)) return 'side'
  if (/^\s*boss\b/.test(title) || /\bmain\s*boss\b/.test(title)) return 'main'
  return null
}

const replayMatchesCard = (
  replay: SeasonalHubReplayRow,
  card: Pick<
    SeasonalBossCardData,
    | 'playbookId'
    | 'playbookName'
    | 'bossType'
    | 'bossName'
    | 'difficultyCode'
    | 'boardId'
    | 'boardLabel'
    | 'seasonNumber'
  > & {
    encounterIndex: number
    encounterType: string | null
  }
) => {
  const replayBossKey = normalizeKey(replay.boss_id)
  const cardBossKeys = [
    card.playbookId,
    card.playbookName,
    card.bossType,
    card.bossName
  ].map(normalizeKey)
  if (!replayBossKey || !cardBossKeys.includes(replayBossKey)) return false

  const replayDifficulty = extractDifficultyCode(
    replay.rarity_set,
    replay.difficulty,
    replay.title
  )
  if (replayDifficulty !== card.difficultyCode) return false

  const isMainEncounter = card.encounterIndex === 0
  const titleKey = normalizeKey(replay.title)
  const sideNameKey = normalizeKey(card.bossName)
  const titleNamesSideEncounter = Boolean(
    !isMainEncounter && sideNameKey && titleKey.includes(sideNameKey)
  )
  const role =
    replayEncounterRole(replay) ?? (titleNamesSideEncounter ? 'side' : null)
  if (isMainEncounter) {
    if (role && role !== 'main') return false
  } else {
    if (role === 'main') return false
  }

  const replayBoard = normalizeBoard(replay.map_id)
  const cardBoard = normalizeBoard(card.boardId)
  if (replayBoard && replayBoard === cardBoard) return true

  const replayHasExactBoard = replayBoard.startsWith('gb_')
  if (replayHasExactBoard) return false

  if (isMainEncounter && role !== 'main') return false
  if (!isMainEncounter && role !== 'side') return false

  const replayMapNumber = extractMapNumber(replay.map_id, replay.title)
  const cardMapNumber = extractMapNumber(card.boardId, card.boardLabel)
  return Boolean(
    replayMapNumber && cardMapNumber && replayMapNumber === cardMapNumber
  )
}

// Featured-pin map key, shared by the loader, the pins API route and buildEncounter.
export const guildFeaturedPinKey = (
  bossId: string | null | undefined,
  encounterRole: string
) => `${canonicalGuildPinBossKey(bossId)}|${encounterRole}`

const replayScore = (
  replay: SeasonalHubReplayRow,
  seasonNumber: number,
  pinnedReplayId?: string | null
) => {
  // A guild pin outranks everything; 10x the featured bonus keeps the bands disjoint.
  const pinned =
    pinnedReplayId && replay.id === pinnedReplayId ? 10_000_000_000 : 0
  const featured = replay.is_featured ? 1_000_000_000 : 0
  const currentSeason =
    normalizeSeason(replay.season) === seasonNumber ? 100_000_000 : 0
  const damage = typeof replay.damage === 'number' ? replay.damage : 0
  const created = replay.created_at ? Date.parse(replay.created_at) || 0 : 0
  return pinned + featured + currentSeason + damage + created / 100_000_000_000
}

const toHubReplay = (
  replay: SeasonalHubReplayRow,
  playbookHref: string,
  pinnedReplayId?: string | null
): SeasonalHubReplay => ({
  id: replay.id,
  title: replay.title?.trim() || 'Replay',
  damage: replay.damage,
  units: Array.isArray(replay.units) ? replay.units.filter(Boolean) : [],
  season:
    replay.season === null || replay.season === undefined
      ? null
      : String(replay.season),
  isFeatured: Boolean(replay.is_featured),
  isPinnedByGuild: Boolean(pinnedReplayId && replay.id === pinnedReplayId),
  href: `${playbookHref}?replay=${encodeURIComponent(replay.id)}`,
  playbookId: playbookHref.replace(/^\/boss-playbooks\//, ''),
  mediaHref:
    replay.video_type === 'youtube' && replay.video_url
      ? replay.video_url
      : null,
  visibility: replay.visibility ?? null
})

export function buildSeasonalBossHubData({
  lineup,
  playbooks,
  replays = [],
  mapImageUrlsByBoardId,
  bossMappings = [],
  battleMetricsBySlot = {},
  targetTokensBySlot = {},
  metaAtlasTeamsBySlot = {},
  heraldConfigsByBossId = {},
  seasonOpsBySlot = {},
  guildPinnedReplayIdsByKey = {},
  guildCode = null,
  canManageHerald = false,
  canManageTargets = false,
  guildReplayLinkMode = 'off'
}: {
  lineup: SeasonLineupEntry
  playbooks: PlaybooksData
  replays?: SeasonalHubReplayRow[]
  mapImageUrlsByBoardId: Record<string, string | null>
  bossMappings?: SeasonalHubBossMappingRow[]
  battleMetricsBySlot?: Record<string, SeasonalHubBattleMetrics>
  targetTokensBySlot?: Record<string, SeasonalHubTargetToken>
  metaAtlasTeamsBySlot?: Record<string, SeasonalHubMetaAtlasTeam>
  heraldConfigsByBossId?: Record<string, SeasonalHubHeraldConfig>
  seasonOpsBySlot?: Record<string, SeasonalHubSeasonOps>
  // guildFeaturedPinKey(boss_id, encounter_role) -> pinned replay_id.
  guildPinnedReplayIdsByKey?: Record<string, string>
  guildCode?: string | null
  canManageHerald?: boolean
  canManageTargets?: boolean
  guildReplayLinkMode?: Exclude<SeasonalHubReplayLinkMode, 'inherit'>
}): SeasonalBossHubData {
  const playbookLookup = buildPlaybookLookup(playbooks.bosses)
  const bossMappingLookup = buildBossMappingLookup(bossMappings)
  const cards: SeasonalBossCardData[] = []

  const groupsBySlot = new Map<
    string,
    {
      main: SeasonLineupEntry['encounters'][number] | null
      encounters: SeasonLineupEntry['encounters']
      rarity: 'Mythic' | 'Legendary'
      setNumber: number
    }
  >()

  for (const encounter of lineup.encounters) {
    const rarity = RARITY_BY_INDEX[encounter.rarityIndex ?? -1]
    if (!rarity || !encounter.boardId) continue
    const slotKey = `${encounter.bossType}|${rarity}|${encounter.set}`
    const existing = groupsBySlot.get(slotKey) ?? {
      main: null,
      encounters: [],
      rarity,
      setNumber: encounter.set
    }
    existing.encounters.push(encounter)
    if (encounter.encounterIndex === 0) existing.main = encounter
    groupsBySlot.set(slotKey, existing)
  }

  for (const slot of groupsBySlot.values()) {
    const mainEncounter = slot.main
    if (!mainEncounter?.boardId) continue
    const playbook = resolvePlaybook(playbookLookup, mainEncounter.bossType)
    if (!playbook) continue

    const rarity = slot.rarity
    const setNumber = slot.setNumber
    const difficultyCode = difficultyCodeFor(rarity, setNumber)
    const playbookHref = `/boss-playbooks/${playbook.id}`

    const buildEncounter = (
      encounter: SeasonLineupEntry['encounters'][number]
    ): SeasonalEncounterData | null => {
      if (!encounter.boardId) return null
      const mapping = bossMappingLookup.get(
        `${normalizeKey(encounter.bossType)}|${encounter.encounterIndex}`
      )
      const bossName = bossDisplayNameForEncounter({
        bossType: encounter.bossType,
        encounterIndex: encounter.encounterIndex,
        mappedName: mapping?.boss_name,
        fallbackName: playbook.name
      })
      const portraitLookupName = portraitLookupNameForEncounter({
        bossType: encounter.bossType,
        encounterIndex: encounter.encounterIndex,
        mappedAssetSlug: mapping?.asset_slug,
        mappedName: mapping?.boss_name,
        fallbackLookupName: encounter.encounterIndex === 0 ? playbook.id : null
      })
      const baseCard = {
        playbookId: playbook.id,
        playbookName: playbook.name,
        bossType: encounter.bossType,
        bossName,
        difficultyCode,
        seasonNumber: lineup.season,
        boardId: encounter.boardId,
        boardLabel: formatBoardLabel(encounter.boardId),
        encounterIndex: encounter.encounterIndex,
        encounterType: encounter.encounterType
      }

      // Try every boss identity the card answers to; the pin key uses the replay's canonical key.
      const pinBossKeys = Array.from(
        new Set(
          [playbook.id, playbook.name, encounter.bossType]
            .map((value) => canonicalGuildPinBossKey(value))
            .filter(Boolean)
        )
      )
      const pinRoles =
        encounter.encounterIndex === 0 ? ['boss'] : ['prime', 'sideboss']
      let pinnedReplayId: string | null = null
      for (const bossKey of pinBossKeys) {
        for (const role of pinRoles) {
          const candidate =
            guildPinnedReplayIdsByKey[`${bossKey}|${role}`] ?? null
          if (candidate) {
            pinnedReplayId = candidate
            break
          }
        }
        if (pinnedReplayId) break
      }

      const matchingReplays = replays
        .filter((replay) => replayMatchesCard(replay, baseCard))
        .sort(
          (a, b) =>
            replayScore(b, lineup.season, pinnedReplayId) -
            replayScore(a, lineup.season, pinnedReplayId)
        )

      const topReplays = matchingReplays
        .slice(0, 5)
        .map((replay) => toHubReplay(replay, playbookHref, pinnedReplayId))
      // Prefer a replay with units: the "Replay top team" panel would blank on an empty one.
      const topReplay =
        matchingReplays.find(
          (replay) => Array.isArray(replay.units) && replay.units.some(Boolean)
        ) ??
        matchingReplays[0] ??
        null
      const highestDamageVideo =
        matchingReplays.reduce<SeasonalHubReplayRow | null>((best, replay) => {
          if (!best) return replay
          return (replay.damage ?? -1) > (best.damage ?? -1) ? replay : best
        }, null)
      const highestDamageUnits = Array.isArray(highestDamageVideo?.units)
        ? highestDamageVideo.units.filter(Boolean)
        : []
      const bestAvailableUnits =
        highestDamageUnits.length > 0
          ? highestDamageUnits
          : Array.isArray(topReplay?.units)
            ? topReplay.units.filter(Boolean)
            : []
      const bestAvailableDamage = highestDamageVideo?.damage ?? null
      const targetKey = seasonalTargetTokenKey({
        bossType: encounter.bossType,
        rarity,
        setNumber,
        encounterIndex: encounter.encounterIndex
      })
      const metaAtlasTopTeam =
        metaAtlasTeamsBySlot[
          seasonalMetaAtlasTeamKey({
            bossType: encounter.bossType,
            raritySet: difficultyCode,
            encounterIndex: encounter.encounterIndex
          })
        ] ?? null
      const battleMetrics =
        battleMetricsBySlot[
          seasonalBattleMetricKey({
            rarity,
            setNumber,
            encounterIndex: encounter.encounterIndex
          })
        ] ?? null
      const bossId = `${encounter.bossType}_E${encounter.encounterIndex}`
      const seasonOps =
        seasonOpsBySlot[
          seasonalOpsKey({
            seasonNumber: lineup.season,
            difficultyCode
          })
        ] ?? null
      const config = heraldConfigsByBossId[bossId] ?? null
      const { roleIds, roleLabels, notes, behaviour, thresholdHpPct } =
        resolveEncounterOps({
          encounterId: encounter.encounterIndex,
          seasonOps,
          heraldConfig: config
        })
      const benchmarkDamage = metaAtlasBenchmarkDamage(metaAtlasTopTeam)
      const availableReplayDamages = matchingReplays.flatMap((replay) =>
        replay.damage == null ? [] : [replay.damage]
      )
      const replaysAboveMetaAtlasBenchmark =
        benchmarkDamage == null
          ? 0
          : availableReplayDamages.filter((damage) => damage > benchmarkDamage)
              .length

      return {
        key: `${lineup.season}-${encounter.bossType}-${rarity}-${setNumber}-${encounter.encounterIndex}`,
        bossId,
        bossType: encounter.bossType,
        encounterIndex: encounter.encounterIndex,
        encounterType: encounter.encounterType,
        bossName,
        portraitLookupName,
        boardId: encounter.boardId,
        boardLabel: formatBoardLabel(encounter.boardId),
        mapImageUrl:
          mapImageUrlsByBoardId[encounter.boardId] ??
          boardImageFallbackUrl(encounter.boardId, playbook.id),
        // Replay-derived when available, else the Meta Atlas benchmark; never null.
        topTeamUnits: bestAvailableUnits.length
          ? bestAvailableUnits
          : (metaAtlasTopTeam?.units ?? []),
        topDamage: bestAvailableDamage ?? benchmarkDamage,
        metaAtlasTopTeam,
        replayCount: matchingReplays.length,
        topReplays,
        availableReplayCount: matchingReplays.length,
        metaAtlasBenchmarkRank:
          benchmarkDamage == null ? null : replaysAboveMetaAtlasBenchmark + 1,
        replaysAboveMetaAtlasBenchmark,
        battleMetrics,
        targetToken: resolveSeasonalTargetToken(
          targetTokensBySlot,
          lineup.season,
          targetKey
        ),
        roleIds,
        roleLabels,
        notes,
        replayLinkMode: config?.replayLinkMode ?? 'inherit',
        replayAutoCount: config?.replayAutoCount ?? 0,
        extraLinks: config?.extraLinks ?? [],
        customMessageUrl: config?.customMessageUrl ?? null,
        wikiUrl: playbook.wikiUrl ?? null,
        tacticusTableUrl: tacticusTableUrlFor(
          playbook,
          encounter.encounterIndex
        ),
        behaviour,
        thresholdHpPct
      }
    }

    const mainData = buildEncounter(mainEncounter)
    if (!mainData) continue
    const sideEncounters = slot.encounters
      .filter((encounter) => encounter.encounterIndex !== 0)
      .sort((a, b) => a.encounterIndex - b.encounterIndex)
      .map(buildEncounter)
      .filter(
        (encounter): encounter is SeasonalEncounterData => encounter !== null
      )
    const seasonOps =
      seasonOpsBySlot[
        seasonalOpsKey({ seasonNumber: lineup.season, difficultyCode })
      ] ?? null

    cards.push({
      key: `${lineup.season}-${mainEncounter.bossType}-${rarity}-${setNumber}`,
      bossType: mainEncounter.bossType,
      bossName: mainData.bossName,
      portraitLookupName: mainData.portraitLookupName,
      playbookId: playbook.id,
      playbookName: playbook.name,
      playbookHref,
      seasonNumber: lineup.season,
      rarity,
      setNumber,
      difficultyCode,
      boardId: mainData.boardId,
      boardLabel: mainData.boardLabel,
      mapImageUrl: mainData.mapImageUrl,
      topTeamUnits: mainData.topTeamUnits,
      topDamage: mainData.topDamage,
      metaAtlasTopTeam: mainData.metaAtlasTopTeam,
      replayCount: mainData.replayCount,
      topReplays: mainData.topReplays,
      mainEncounter: mainData,
      sideEncounters,
      battleMetrics: mainData.battleMetrics,
      targetToken: mainData.targetToken,
      roleIds: mainData.roleIds,
      seasonOps
    })
  }

  return {
    seasonNumber: lineup.season,
    configId: lineup.configId,
    capturedAt: lineup.capturedAt ?? null,
    groups: GROUP_ORDER.map((rarity) => ({
      rarity,
      cards: cards
        .filter((card) => card.rarity === rarity)
        .sort((a, b) => b.setNumber - a.setNumber)
    })).filter((group) => group.cards.length > 0),
    guildCode,
    canManageHerald,
    canManageTargets,
    guildReplayLinkMode
  }
}
