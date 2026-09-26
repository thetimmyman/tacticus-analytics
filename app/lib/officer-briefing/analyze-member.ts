// Compares the dominant used team per (boss_type, encounter_index, rarity_set) with the best
// FIELDABLE meta template. Keys on rarity_set ('L4'); the `rarity` word matches no template.

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { parseTeamComposition } from '@/app/lib/meta/team-coverage'
import {
  buildHeroCatalog,
  HERO_MAPPINGS_SELECT,
  HeroCatalog
} from '@/app/lib/catalogs/heroes'
import { classifyMemberBoss } from './classifier'
import { loadRecentAttacks } from './recent-attacks'
import { getRankIndexFromName } from '@/app/lib/tacticus/ranks'
import {
  fetchGlobalThresholds,
  evaluateHeroAgainstThreshold,
  type GlobalThreshold
} from '@/app/lib/services/strength-precedence'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import type {
  MemberBossVerdict,
  MemberDetailResponse,
  SwapStep,
  TeamSummary
} from './types'

const META_MIN_ATTACK_COUNT = 20
const ROSTER_FRESH_MS = 24 * 60 * 60 * 1000
const UNFIELDABLE_RARITIES = new Set(['common', 'uncommon'])

// Generated types omit boss_name / rarity_set / encounter_index.
interface TeamUsageRow {
  boss_name: string
  boss_type: string
  rarity_set: string | null
  encounter_index: number
  team_hash: string
  team_composition: string
  attack_count: number
  avg_damage: number
  meta_team: string | null
}

interface MetaRow {
  team_hash: string
  team_composition: string | null
  meta_team: string | null
  boss_type: string
  encounter_index: number
  rarity_set: string | null
  season: string
  damage_avg: number | null
  damage_p90: number | null
  attack_count: number | null
}

interface RosterRow {
  player_display_name: string
  hero_display_name: string
  unit_id: string
  rarity: string | null
  stars: number | null
  rank_name: string | null
  active_ability_level: number | null
  passive_ability_level: number | null
  synced_at: string | null
}

function teamSummary(
  composition: string,
  metaTeam: string | null
): TeamSummary {
  const { heroes, mow } = parseTeamComposition(composition)
  return { composition, heroes, mow, metaTeam }
}

function computeSwaps(
  usedComposition: string,
  bestComposition: string
): SwapStep[] {
  const used = parseTeamComposition(usedComposition)
  const best = parseTeamComposition(bestComposition)
  const usedAll = used.mow ? [...used.heroes, used.mow] : used.heroes
  const bestAll = best.mow ? [...best.heroes, best.mow] : best.heroes
  const usedLower = new Set(usedAll.map((h) => h.toLowerCase()))
  const bestLower = new Set(bestAll.map((h) => h.toLowerCase()))
  const out = usedAll.filter((h) => !bestLower.has(h.toLowerCase()))
  const incoming = bestAll.filter((h) => !usedLower.has(h.toLowerCase()))
  const swaps: SwapStep[] = []
  const n = Math.max(out.length, incoming.length)
  for (let i = 0; i < n; i++) {
    swaps.push({ out: out[i] ?? '—', in: incoming[i] ?? '—' })
  }
  return swaps
}

/** Heroes only: the roster does not track MoWs. */
function isFieldable(
  composition: string,
  catalog: HeroCatalog,
  ownedUnits: Set<string>
): boolean {
  const { heroes } = parseTeamComposition(composition)
  if (heroes.length === 0) return false
  for (const h of heroes) {
    const unit = catalog.getByName(h)?.unitId
    if (!unit || !ownedUnits.has(unit)) return false
  }
  return true
}

interface AnalyzeArgs {
  supabase: TypedSupabaseClient
  guildCode: string
  displayName: string
  season: string
  nowMs: number
}

export interface Group {
  bossName: string
  bossType: string
  encounterId: number
  raritySet: string | null
  usedHash: string
  usedComposition: string
  usedMetaTeam: string | null
  actualAvg: number
  battleCount: number
  dominantAttacks: number
}

interface AnalysisContext {
  metaRows: MetaRow[]
  catalog: HeroCatalog
}

interface MemberRoster {
  ownedUnits: Set<string>
  rosterSyncedAt: string | null
}

export function buildGroupsFromUsage(usage: TeamUsageRow[]): Group[] {
  const groups = new Map<string, Group>()
  for (const r of usage) {
    const key = `${r.boss_type}::${r.encounter_index}::${r.rarity_set ?? ''}`
    const g = groups.get(key)
    if (!g) {
      groups.set(key, {
        bossName: r.boss_name,
        bossType: r.boss_type,
        encounterId: r.encounter_index,
        raritySet: r.rarity_set,
        usedHash: r.team_hash,
        usedComposition: r.team_composition,
        usedMetaTeam: r.meta_team,
        actualAvg: r.avg_damage,
        battleCount: r.attack_count,
        dominantAttacks: r.attack_count
      })
    } else {
      g.battleCount += r.attack_count
      if (r.attack_count > g.dominantAttacks) {
        g.dominantAttacks = r.attack_count
        g.usedHash = r.team_hash
        g.usedComposition = r.team_composition
        g.usedMetaTeam = r.meta_team
        g.actualAvg = r.avg_damage
      }
    }
  }
  return [...groups.values()]
}

export async function loadUsage(
  supabase: TypedSupabaseClient,
  guildCode: string,
  displayName: string,
  season: string
): Promise<TeamUsageRow[]> {
  const usageRes = await supabase.rpc('get_player_team_usage', {
    p_player_name: displayName,
    p_guild_code: guildCode,
    p_season: season as unknown as string
  })
  return ((usageRes.data as unknown as TeamUsageRow[] | null) ?? []).filter(
    (r) => r.team_composition
  )
}

async function loadAnalysisContext(
  supabase: TypedSupabaseClient,
  season: string,
  bossTypes: string[]
): Promise<AnalysisContext> {
  if (bossTypes.length === 0) {
    return { metaRows: [], catalog: buildHeroCatalog([]) }
  }

  const metaRes = await supabase
    .from('meta_atlas_data')
    .select(
      'team_hash, team_composition, meta_team, boss_type, encounter_index, rarity_set, season, damage_avg, damage_p90, attack_count'
    )
    .in('boss_type', bossTypes)
    .gte('attack_count', META_MIN_ATTACK_COUNT)
    .not('team_composition', 'is', null)
  const allMeta = (metaRes.data as unknown as MetaRow[] | null) ?? []

  // The atlas lags: use the latest atlas season <= requested (never mix seasons' damage scales).
  const reqSeasonNum = Number.parseInt(season, 10)
  const availSeasons = [
    ...new Set(
      allMeta
        .map((m) => Number.parseInt(m.season, 10))
        .filter(
          (n) =>
            Number.isFinite(n) &&
            (!Number.isFinite(reqSeasonNum) || n <= reqSeasonNum)
        )
    )
  ]
  const atlasSeason = availSeasons.length ? Math.max(...availSeasons) : null
  const metaRows =
    atlasSeason != null
      ? allMeta.filter((m) => Number.parseInt(m.season, 10) === atlasSeason)
      : allMeta

  // The catalog resolves aliases, so alias-named templates stay fieldable.
  const heroMapRes = await supabase
    .from('hero_mappings')
    .select(HERO_MAPPINGS_SELECT)
  const catalog = buildHeroCatalog(heroMapRes.data)

  return { metaRows, catalog }
}

function unitIdsFromContext(ctx: AnalysisContext): string[] {
  const heroNames = new Set<string>()
  for (const m of ctx.metaRows) {
    if (!m.team_composition) continue
    const { heroes } = parseTeamComposition(m.team_composition)
    for (const h of heroes) heroNames.add(h)
  }
  return [
    ...new Set(
      [...heroNames]
        .map((n) => ctx.catalog.getByName(n)?.unitId)
        .filter((u): u is string => Boolean(u))
    )
  ]
}

async function loadGuildRoster(
  supabase: TypedSupabaseClient,
  guildCode: string,
  unitIds: string[]
): Promise<Map<string, MemberRoster>> {
  const out = new Map<string, MemberRoster>()
  if (unitIds.length === 0) return out

  // Untyped RPC: cast the CLIENT, not the method; a detached rpc throws.
  const sbRpc = supabase as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>
  }
  const rosterRes = await sbRpc.rpc('get_guild_team_roster', {
    p_guild_code: guildCode,
    p_unit_ids: unitIds
  })
  const rosterRows = (rosterRes.data as RosterRow[] | null) ?? []

  // Exclude a hero only when threshold and rank both prove it below its rarity's "Suitable" minimum.
  const suitableByRarity = new Map<string, GlobalThreshold>()
  const raritiesPresent = [
    ...new Set(
      rosterRows
        .map((r) => r.rarity)
        .filter((x): x is string => Boolean(x))
        .filter((r) => !UNFIELDABLE_RARITIES.has(r.toLowerCase()))
    )
  ]
  await Promise.all(
    raritiesPresent.map(async (rarity) => {
      try {
        const thresholds = await fetchGlobalThresholds(
          supabase as unknown as SupabaseClient,
          rarity
        )
        const suitable = thresholds.find((t) => t.strength_level === 'Suitable')
        if (suitable) suitableByRarity.set(rarity.toLowerCase(), suitable)
      } catch {
        /* no threshold: stay permissive */
      }
    })
  )

  for (const row of rosterRows) {
    if (row.stars == null) continue // not owned
    if (row.rarity && UNFIELDABLE_RARITIES.has(row.rarity.toLowerCase()))
      continue
    const suitable = row.rarity
      ? suitableByRarity.get(row.rarity.toLowerCase())
      : undefined
    if (suitable) {
      const heroRank = getRankIndexFromName(row.rank_name)
      if (
        heroRank != null &&
        !evaluateHeroAgainstThreshold(
          heroRank,
          row.active_ability_level,
          row.passive_ability_level,
          suitable
        )
      ) {
        continue
      }
    }
    let m = out.get(row.player_display_name)
    if (!m) {
      m = { ownedUnits: new Set<string>(), rosterSyncedAt: null }
      out.set(row.player_display_name, m)
    }
    m.ownedUnits.add(row.unit_id)
    if (
      row.synced_at &&
      (!m.rosterSyncedAt || row.synced_at > m.rosterSyncedAt)
    ) {
      m.rosterSyncedAt = row.synced_at
    }
  }
  return out
}

function buildVerdicts(
  groups: Group[],
  ctx: AnalysisContext,
  roster: MemberRoster | undefined,
  nowMs: number
): {
  verdicts: MemberBossVerdict[]
  headline: MemberBossVerdict | null
  rosterSyncedAt: string | null
} {
  const ownedUnits = roster?.ownedUnits ?? new Set<string>()
  const rosterSyncedAt = roster?.rosterSyncedAt ?? null
  const rosterStale =
    !rosterSyncedAt || nowMs - Date.parse(rosterSyncedAt) > ROSTER_FRESH_MS

  const verdicts: MemberBossVerdict[] = []
  for (const g of groups) {
    // Primes share the main's boss_type; the main's templates would give an impossible target.
    const templates = ctx.metaRows.filter(
      (m) =>
        m.boss_type === g.bossType &&
        m.encounter_index === g.encounterId &&
        (g.raritySet == null || m.rarity_set === g.raritySet)
    )

    const usedTemplate = templates.find((t) => t.team_hash === g.usedHash)
    const expectedForUsedTeam = usedTemplate?.damage_avg ?? null

    // The used team is always a candidate, so best-fieldable never ranks below it.
    let bestFieldable: MetaRow | null = usedTemplate ?? null
    for (const t of templates) {
      if (!t.team_composition || t.damage_avg == null) continue
      if (!isFieldable(t.team_composition, ctx.catalog, ownedUnits)) continue
      if (
        !bestFieldable ||
        (t.damage_avg ?? 0) > (bestFieldable.damage_avg ?? 0)
      ) {
        bestFieldable = t
      }
    }
    const expectedForBestFieldable = bestFieldable?.damage_avg ?? null
    const differs = Boolean(
      bestFieldable && bestFieldable.team_hash !== g.usedHash
    )

    // Off-meta team: no execution gap, but a beatable selection still shows.
    const usedExpForClassifier = expectedForUsedTeam ?? g.actualAvg

    const verdict = classifyMemberBoss({
      actualAvg: g.actualAvg,
      expectedForUsedTeam: usedExpForClassifier,
      expectedForBestFieldable,
      battleCount: g.dominantAttacks, // attacks that actually produced actualAvg
      bestFieldableDiffersFromUsed: differs,
      rosterStale
    })
    const hasActionableSwap =
      verdict.classification === 'needs_support_wrong_team' &&
      differs &&
      Boolean(bestFieldable?.team_hash)

    verdicts.push({
      bossName: g.bossName,
      bossType: g.bossType,
      encounterId: g.encounterId,
      rarity: g.raritySet,
      classification: verdict.classification,
      confidence: verdict.confidence,
      actualAvg: g.actualAvg,
      expectedForUsedTeam,
      expectedForBestFieldable,
      executionGap: verdict.executionGap,
      selectionGap: verdict.selectionGap,
      readyNowUpside: verdict.readyNowUpside,
      teamUsed: teamSummary(g.usedComposition, g.usedMetaTeam),
      bestFieldable:
        bestFieldable && bestFieldable.team_composition
          ? teamSummary(bestFieldable.team_composition, bestFieldable.meta_team)
          : null,
      usedTeamHash: g.usedHash,
      recommendedTeamHash: hasActionableSwap
        ? (bestFieldable?.team_hash ?? null)
        : null,
      swaps:
        hasActionableSwap && bestFieldable?.team_composition
          ? computeSwaps(g.usedComposition, bestFieldable.team_composition)
          : [],
      battleCount: g.battleCount,
      recommendation: verdict.recommendation
    })
  }

  // Among non-actionable, prefer the best-evidenced boss so a 1-attack fluke never headlines.
  const ACTIONABLE = new Set([
    'needs_support_wrong_team',
    'needs_support_correct_team',
    'doing_great'
  ])
  verdicts.sort((a, b) => {
    const aAct = ACTIONABLE.has(a.classification) ? 1 : 0
    const bAct = ACTIONABLE.has(b.classification) ? 1 : 0
    if (aAct !== bAct) return bAct - aAct
    if (aAct === 1) return (b.readyNowUpside ?? 0) - (a.readyNowUpside ?? 0)
    if (b.battleCount !== a.battleCount) return b.battleCount - a.battleCount
    return (b.readyNowUpside ?? 0) - (a.readyNowUpside ?? 0)
  })

  return { verdicts, headline: verdicts[0] ?? null, rosterSyncedAt }
}

export async function analyzeMember(
  args: AnalyzeArgs
): Promise<MemberDetailResponse> {
  const { supabase, guildCode, displayName, season, nowMs } = args

  // Label is for prose only; raw `displayName` stays the key for every RPC and
  // the returned field (the client round-trips it as coaching_tasks identity).
  const memberLabels = await getMemberLabelMap()
  const displayLabel = resolveMemberLabel(displayName, memberLabels)

  const usage = await loadUsage(supabase, guildCode, displayName, season)
  if (usage.length === 0) {
    return {
      displayName,
      guildCode,
      season,
      rosterSyncedAt: null,
      verdicts: [],
      headline: null,
      coachingNote: `No comparable attacks recorded for ${displayLabel} this season.`,
      lastBattleSecondsAgo: null,
      recentAttacks: []
    }
  }

  const groups = buildGroupsFromUsage(usage)
  const bossTypes = [...new Set(groups.map((g) => g.bossType))]

  const ctx = await loadAnalysisContext(supabase, season, bossTypes)
  const rosterByMember = await loadGuildRoster(
    supabase,
    guildCode,
    unitIdsFromContext(ctx)
  )

  const { verdicts, headline, rosterSyncedAt } = buildVerdicts(
    groups,
    ctx,
    rosterByMember.get(displayName),
    nowMs
  )
  const rosterStale =
    !rosterSyncedAt || nowMs - Date.parse(rosterSyncedAt) > ROSTER_FRESH_MS

  let recentAttacks: MemberDetailResponse['recentAttacks'] = []
  let lastBattleSecondsAgo: number | null = null
  try {
    const [attacks, lastRes] = await Promise.all([
      headline
        ? loadRecentAttacks(supabase, {
            guildCode,
            displayName,
            season,
            bossName: headline.bossName,
            raritySet: headline.rarity,
            expected:
              headline.expectedForBestFieldable ?? headline.expectedForUsedTeam
          })
        : Promise.resolve([]),
      supabase
        .from('EOT_GR_data')
        .select('startedOn')
        .eq('Guild', guildCode)
        .eq('Season', season)
        .eq('displayName', displayName)
        .eq('damageType', 'Battle')
        .order('startedOn', { ascending: false })
        .limit(1)
    ])
    recentAttacks = attacks
    const lastIso = (lastRes.data as { startedOn: string | null }[] | null)?.[0]
      ?.startedOn
    const lastMs = lastIso ? Date.parse(lastIso) : NaN
    if (Number.isFinite(lastMs)) {
      lastBattleSecondsAgo = Math.max(0, Math.round((nowMs - lastMs) / 1000))
    }
  } catch {
    /* chart/header context is best-effort */
  }

  return {
    displayName,
    guildCode,
    season,
    rosterSyncedAt,
    verdicts,
    headline,
    coachingNote: buildCoachingNote(displayLabel, headline, rosterStale),
    lastBattleSecondsAgo,
    recentAttacks
  }
}

export interface MemberAnalysisSummary {
  displayName: string
  verdicts: MemberBossVerdict[]
  headline: MemberBossVerdict | null
  rosterSyncedAt: string | null
}

// A per-member failure yields a null headline; a SHARED fetch failure rejects, so callers must `.catch`.
const USAGE_CONCURRENCY = 6

export async function analyzeGuildMembers(args: {
  supabase: TypedSupabaseClient
  guildCode: string
  displayNames: string[]
  season: string
  nowMs: number
}): Promise<Map<string, MemberAnalysisSummary>> {
  const { supabase, guildCode, displayNames, season, nowMs } = args
  const result = new Map<string, MemberAnalysisSummary>()
  const names = [...new Set(displayNames)].filter(Boolean)
  if (names.length === 0) return result

  const usageByMember = new Map<string, TeamUsageRow[]>()
  for (let i = 0; i < names.length; i += USAGE_CONCURRENCY) {
    await Promise.all(
      names.slice(i, i + USAGE_CONCURRENCY).map(async (name) => {
        try {
          usageByMember.set(
            name,
            await loadUsage(supabase, guildCode, name, season)
          )
        } catch {
          usageByMember.set(name, [])
        }
      })
    )
  }

  const groupsByMember = new Map<string, Group[]>()
  const bossTypes = new Set<string>()
  for (const name of names) {
    const groups = buildGroupsFromUsage(usageByMember.get(name) ?? [])
    groupsByMember.set(name, groups)
    for (const g of groups) bossTypes.add(g.bossType)
  }

  const ctx = await loadAnalysisContext(supabase, season, [...bossTypes])
  const rosterByMember = await loadGuildRoster(
    supabase,
    guildCode,
    unitIdsFromContext(ctx)
  )

  for (const name of names) {
    const groups = groupsByMember.get(name) ?? []
    if (groups.length === 0) {
      result.set(name, {
        displayName: name,
        verdicts: [],
        headline: null,
        rosterSyncedAt: null
      })
      continue
    }
    const { verdicts, headline, rosterSyncedAt } = buildVerdicts(
      groups,
      ctx,
      rosterByMember.get(name),
      nowMs
    )
    result.set(name, { displayName: name, verdicts, headline, rosterSyncedAt })
  }

  return result
}

function fmt(n: number | null): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1000)}k`
  return `${Math.round(n)}`
}

function buildCoachingNote(
  displayName: string,
  headline: MemberBossVerdict | null,
  rosterStale: boolean
): string {
  if (!headline) return `No actionable signal for ${displayName} this season.`
  const boss = `${headline.bossName}${headline.encounterId ? ` (prime ${headline.encounterId})` : ''}`
  switch (headline.classification) {
    case 'needs_support_wrong_team': {
      const swap = headline.swaps
        .map((s) => `out ${s.out} → in ${s.in}`)
        .join('; ')
      return `${displayName} — ${boss}: a stronger team is available now (projects ~+${fmt(headline.readyNowUpside)}/attack) from heroes already owned. Suggested change: ${swap || 'see best-available team'}.${rosterStale ? ' (Roster data is stale — confirm before advising.)' : ''}`
    }
    case 'needs_support_correct_team':
      return `${displayName} — ${boss}: on about the best team they can field but ~${fmt(headline.executionGap)}/attack below the population average. Review execution/tactics rather than the team.${rosterStale ? ' (Roster data is stale — confirm before advising.)' : ''}`
    case 'doing_great':
      return `${displayName} — ${boss}: performing above roster-adjusted expectation. Recognize the result.`
    case 'roster_limited':
      return `${displayName} — ${boss}: performing about as well as their current roster allows. No coaching task.`
    default:
      return `${displayName} — ${boss}: not enough comparable attacks to advise yet.`
  }
}
