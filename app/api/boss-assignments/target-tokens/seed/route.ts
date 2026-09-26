/** Seeds target_tokens from guild history; never overwrites source='officer_manual'. App-admin only. */

import { NextRequest, NextResponse } from 'next/server'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { throwUserFacingError } from '@/app/lib/errors/user-facing'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { db } from '@/app/lib/db'
import { buildBattleRowsQuery } from '@/app/lib/data/battle-rows'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { lookupPrimeBossHp } from '@/app/lib/data/prime-boss-hp'
import { getLatestSeason } from '@/app/lib/utils/season'
import {
  getSeasonConfigById,
  getSeasonConfigForSeasonNumber,
  getSeasonConfigIdForOffset,
  SEASON_ROTATION,
  SEASON_NUMBER_OFFSET,
  ROTATION_INDEX_OFFSET
} from '@/app/lib/loki/season-configs'
import { isSweepRow } from '@/app/lib/calculations/utils/sweep-helpers'
import { createComponentLogger } from '@/app/lib/logging'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'
const logger = createComponentLogger('api.boss-assignments.target-tokens.seed')

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const profile = authData.profile
    if (!profile.is_app_admin) {
      throwUserFacingError(
        'ACCESS_DENIED',
        'Boss assignments are restricted to app administrators',
        403,
        { component: 'boss-target-tokens-seed', action: 'check_role' }
      )
    }
    const guildCode = profile.guild_code
    if (!guildCode) {
      throw Errors.fromStatus(400, 'guild_code required on profile', {
        code: 'VALIDATION_ERROR'
      })
    }

    const seedBody = (await request.json().catch(() => null)) as {
      season?: unknown
    } | null
    const rawSeedSeason = seedBody?.season
    let requestedSeedSeasonNum: number | null = null
    if (
      rawSeedSeason !== undefined &&
      rawSeedSeason !== null &&
      rawSeedSeason !== ''
    ) {
      const parsedSeason = parseSeasonParam(rawSeedSeason)
      if (parsedSeason === null) {
        throw Errors.fromStatus(
          400,
          'season must be a positive integer string',
          { code: 'VALIDATION_ERROR' }
        )
      }
      requestedSeedSeasonNum = Number.parseInt(parsedSeason, 10)
    }

    const supabase = await db()
    const bossHpData = await getAllBossHp(guildCode)

    // Includes the current season: partial data beats "None available" for current-only slots.
    const SEED_WINDOW_SEASONS = 20
    const latestSeason = await getLatestSeason()
    if (latestSeason === null) {
      throw Errors.fromStatus(503, 'Season data unavailable', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }
    const latestNum = parseInt(latestSeason, 10)
    if (!Number.isFinite(latestNum)) {
      throw Errors.fromStatus(500, 'Unable to resolve latest season', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }

    const seedSeasonNum = requestedSeedSeasonNum ?? latestNum
    const seedSeason = String(seedSeasonNum)
    const seedSeasons = Array.from(
      { length: SEED_WINDOW_SEASONS },
      (_, i) => latestNum - i
    )
      .filter((s) => s > 0)
      .map((s) => String(s))
    if (seedSeasons.length === 0) {
      return NextResponse.json({
        rows_written: 0,
        note: 'No prior seasons to seed from'
      })
    }

    const { data: damageRows, error: damageErr } = await buildBattleRowsQuery<{
      Name: string | null
      set: number | null
      damageDealt: number | null
      remainingHp: number | null
      maxHp: number | null
      Season: string | null
      rarity: string | null
      encounterId: number | null
    }>(supabase, {
      select:
        'Name, set, damageDealt, remainingHp, maxHp, Season, rarity, encounterId',
      scope: { guild: guildCode },
      seasons: seedSeasons,
      rarities: ['Legendary', 'Mythic'],
      encounters: 'main-and-primes'
    })
    if (damageErr) {
      logger.error(
        { guildCode, error: damageErr },
        'seed target tokens: damage query failed'
      )
      throw Errors.fromStatus(500, 'Failed to read historical damage', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }

    // Tolerates name drift: exact `name_level`, then stripped suffix, then substring.
    const STRIPPABLE_SUFFIXES = ['RW', 'Wing']
    const tryStrip = (name: string): string[] => {
      const variants = [name]
      for (const sfx of STRIPPABLE_SUFFIXES) {
        if (name.endsWith(sfx) && name.length > sfx.length) {
          variants.push(name.slice(0, -sfx.length))
        }
      }
      return variants
    }
    const lookupHp = (name: string, level: string): number => {
      const table = bossHpData.byBossName ?? {}
      for (const variant of tryStrip(name)) {
        const candidates = [
          `${variant}_${level}`,
          variant,
          variant.toLowerCase(),
          variant.replace(/\s+/g, ''),
          variant.replace(/\s+/g, '').toLowerCase(),
          `${variant.replace(/\s+/g, '')}_${level}`,
          `${variant.replace(/\s+/g, '').toLowerCase()}_${level}`
        ]
        for (const c of candidates) {
          const hp = table[c] ?? 0
          if (hp > 0) return hp
        }
      }
      // Prefer `_level`-keyed hits; bare-name HP is "last level wins".
      const n = name.replace(/\s+/g, '').toLowerCase()
      for (const k of Object.keys(table)) {
        if (!k.endsWith(`_${level}`)) continue
        const stem = k.slice(0, -`_${level}`.length).toLowerCase()
        if (n.startsWith(stem) || stem.startsWith(n)) {
          const hp = table[k] ?? 0
          if (hp > 0) return hp
        }
      }
      for (const k of Object.keys(table)) {
        if (k.includes('_')) continue
        const nk = k.toLowerCase()
        if (n.startsWith(nk) || nk.startsWith(n)) {
          const hp = table[k] ?? 0
          if (hp > 0) return hp
        }
      }
      return 0
    }
    // Prime rows carry the prime in Name; resolve the main bossType via the season's rotation.
    const configBySeason = new Map<
      number,
      ReturnType<typeof getSeasonConfigById>
    >()
    const rotLen = SEASON_ROTATION.length || 5
    const resolveMainBossType = (
      seasonNum: number,
      rarity: 'Legendary' | 'Mythic',
      setOneIndexed: number,
      eid: number
    ): string | null => {
      if (!configBySeason.has(seasonNum)) {
        const capturedConfig = getSeasonConfigForSeasonNumber(seasonNum)
        if (capturedConfig) {
          configBySeason.set(seasonNum, capturedConfig)
        } else {
          const idx =
            (((seasonNum + SEASON_NUMBER_OFFSET + ROTATION_INDEX_OFFSET - 1) %
              rotLen) +
              rotLen) %
            rotLen
          const cfgId = SEASON_ROTATION[idx]
          if (!cfgId) return null
          configBySeason.set(seasonNum, getSeasonConfigById(cfgId))
        }
      }
      const cfg = configBySeason.get(seasonNum)!
      const match = cfg.bosses.find(
        (b) =>
          b.rarity === rarity &&
          b.set + 1 === setOneIndexed &&
          b.encounter_id === eid
      )
      return match?.boss_type ?? null
    }

    type PerBossKey = string // `${mainBossType}__${rarity}__${set}__${encounter_id}`
    const perBoss = new Map<
      PerBossKey,
      { totalDamage: number; totalAttacks: number }
    >()

    ;(damageRows ?? []).forEach((row) => {
      if (!row.Name) return
      const rarity = row.rarity === 'Mythic' ? 'Mythic' : 'Legendary'
      const setOneIndexed = (row.set ?? 0) + 1
      const eid = typeof row.encounterId === 'number' ? row.encounterId : 0
      if (eid < 0 || eid > 2) return
      const dmg = row.damageDealt ?? 0
      // Skip killing blows on a pre-damaged boss; keep one-shots.
      if (
        isSweepRow({
          remainingHp: row.remainingHp ?? null,
          maxHp: row.maxHp ?? null,
          damageDealt: row.damageDealt ?? null
        })
      ) {
        return
      }

      let mainType: string | null = null
      if (eid === 0) {
        mainType = row.Name
      } else {
        const seasonNum = parseInt(row.Season ?? '', 10)
        if (!Number.isFinite(seasonNum)) return
        mainType = resolveMainBossType(seasonNum, rarity, setOneIndexed, eid)
      }
      if (!mainType) return

      const pk = `${mainType}__${rarity}__${setOneIndexed}__${eid}`
      const pb = perBoss.get(pk) ?? { totalDamage: 0, totalAttacks: 0 }
      pb.totalDamage += dmg
      pb.totalAttacks += 1
      perBoss.set(pk, pb)
    })

    const firstSeedSeason = seedSeasons[0]
    const lastSeedSeason = seedSeasons[seedSeasons.length - 1]
    if (!firstSeedSeason || !lastSeedSeason) {
      return NextResponse.json({
        rows_written: 0,
        note: 'No prior seasons to seed from'
      })
    }
    const seededFromSeasons = `S${lastSeedSeason}-S${firstSeedSeason}`

    // Same-rarity cohort mean: last-resort fallback, labeled in seeded_from_seasons.
    type CohortKey = string // `${rarity}__${set}__${encounter_id}`
    const cohortAccum = new Map<
      CohortKey,
      { tokenSum: number; bossCount: number; attackCount: number }
    >()
    perBoss.forEach((agg, pk) => {
      if (agg.totalAttacks <= 0 || agg.totalDamage <= 0) return
      const parts = pk.split('__')
      if (parts.length !== 4) return
      const bossType = parts[0]
      const rarity = parts[1]
      const setStr = parts[2]
      const eidStr = parts[3]
      if (
        !bossType ||
        (rarity !== 'Legendary' && rarity !== 'Mythic') ||
        !setStr ||
        !eidStr
      ) {
        return
      }
      const setOneIndexed = parseInt(setStr, 10)
      const eid = parseInt(eidStr, 10)
      if (!Number.isFinite(setOneIndexed) || !Number.isFinite(eid)) return
      if (eid !== 0 && eid !== 1 && eid !== 2) return
      const levelCode = `${rarity === 'Mythic' ? 'M' : 'L'}${setOneIndexed}`
      const bossHp =
        eid === 0
          ? lookupHp(bossType, levelCode)
          : lookupPrimeBossHp(
              bossType,
              levelCode,
              bossHpData.primes ?? {},
              eid as 1 | 2
            )
      if (!(bossHp > 0)) return
      const avgDamagePerAttack = agg.totalDamage / agg.totalAttacks
      const tokensToKill = bossHp / avgDamagePerAttack
      if (!Number.isFinite(tokensToKill) || tokensToKill <= 0) return
      const ck = `${rarity}__${setOneIndexed}__${eid}`
      const existing = cohortAccum.get(ck) ?? {
        tokenSum: 0,
        bossCount: 0,
        attackCount: 0
      }
      existing.tokenSum += tokensToKill
      existing.bossCount += 1
      existing.attackCount += agg.totalAttacks
      cohortAccum.set(ck, existing)
    })
    const cohortMeanTokens = (
      rarity: 'Legendary' | 'Mythic',
      setOneIndexed: number,
      eid: number
    ): number | null => {
      const c = cohortAccum.get(`${rarity}__${setOneIndexed}__${eid}`)
      if (!c || c.bossCount <= 0) return null
      return c.tokenSum / c.bossCount
    }

    const rotationAnchor = getSeasonConfigIdForOffset(0)
    const seededConfig =
      getSeasonConfigForSeasonNumber(seedSeasonNum) ??
      getSeasonConfigById(
        getSeasonConfigIdForOffset(seedSeasonNum - rotationAnchor.seasonNumber)
          .id
      )
    type SlotKey = string
    const currentSlots = new Map<
      SlotKey,
      {
        boss_type: string
        rarity: 'Legendary' | 'Mythic'
        set: number
        encounter_id: number
        main_boss_type: string
      }
    >()
    const mainByRaritySet = new Map<string, string>()
    seededConfig.bosses.forEach((b) => {
      if (b.rarity !== 'Legendary' && b.rarity !== 'Mythic') return
      if (b.encounter_id !== 0) return
      mainByRaritySet.set(`${b.rarity}__${b.set + 1}`, b.boss_type)
    })
    seededConfig.bosses.forEach((b) => {
      if (b.rarity !== 'Legendary' && b.rarity !== 'Mythic') return
      const setOneIndexed = b.set + 1
      const mainBossType = mainByRaritySet.get(`${b.rarity}__${setOneIndexed}`)
      if (!mainBossType) return
      const k = `${b.boss_type}__${b.rarity}__${setOneIndexed}__${b.encounter_id}`
      currentSlots.set(k, {
        boss_type: b.boss_type,
        rarity: b.rarity as 'Legendary' | 'Mythic',
        set: setOneIndexed,
        encounter_id: b.encounter_id,
        main_boss_type: mainBossType
      })
    })

    // `skip` is required: PostgREST null-fills omitted columns across a batch upsert (NOT NULL).
    const rowsToUpsert: Array<{
      guild_code: string
      boss_name: string
      rarity: string
      set: number
      encounter_id: number
      target_tokens: number
      source: 'historical_seed'
      seeded_from_seasons: string
      updated_by: string
      skip: boolean
      season_number: string
    }> = []
    const diagnostics: Array<{ slot: string; reason: string }> = []

    currentSlots.forEach((slot) => {
      const levelCode = `${slot.rarity === 'Mythic' ? 'M' : 'L'}${slot.set}`
      const hp =
        slot.encounter_id === 0
          ? lookupHp(slot.main_boss_type, levelCode)
          : lookupPrimeBossHp(
              slot.main_boss_type,
              levelCode,
              bossHpData.primes ?? {},
              slot.encounter_id as 1 | 2
            )
      if (!(hp > 0)) {
        diagnostics.push({
          slot: `${slot.main_boss_type} ${levelCode} enc${slot.encounter_id}`,
          reason: 'no_hp'
        })
        // Lets the UI tell "none available" from "not seeded yet".
        rowsToUpsert.push({
          guild_code: guildCode,
          boss_name: slot.main_boss_type,
          rarity: slot.rarity,
          set: slot.set,
          encounter_id: slot.encounter_id,
          target_tokens: 1, // sentinel; DB requires > 0
          source: 'historical_seed',
          seeded_from_seasons: 'none available',
          skip: true, // consumers filter skip=true, so sentinel doesn't mis-score
          updated_by: authData.user.id,
          season_number: seedSeason
        })
        return
      }

      // Exact set, then lower sets, then cohort mean, then placeholder; M never imports L averages.
      let avgDamage: number | null = null
      let fallbackFromSet: number | null = null
      let cohortFallback = false
      for (let trySet = slot.set; trySet >= 1; trySet--) {
        const pb = perBoss.get(
          `${slot.main_boss_type}__${slot.rarity}__${trySet}__${slot.encounter_id}`
        )
        if (pb && pb.totalAttacks > 0 && pb.totalDamage > 0) {
          avgDamage = pb.totalDamage / pb.totalAttacks
          if (trySet !== slot.set) fallbackFromSet = trySet
          break
        }
      }

      let cohortTokens: number | null = null
      if (avgDamage === null) {
        cohortTokens = cohortMeanTokens(
          slot.rarity,
          slot.set,
          slot.encounter_id
        )
        if (cohortTokens !== null) {
          cohortFallback = true
        }
      }

      if (avgDamage === null && cohortTokens === null) {
        diagnostics.push({
          slot: `${slot.main_boss_type} ${levelCode} enc${slot.encounter_id}`,
          reason: 'no_data_any_tier'
        })
        rowsToUpsert.push({
          guild_code: guildCode,
          boss_name: slot.main_boss_type,
          rarity: slot.rarity,
          set: slot.set,
          encounter_id: slot.encounter_id,
          target_tokens: 1,
          source: 'historical_seed',
          seeded_from_seasons: 'none available',
          skip: true, // consumers filter skip=true, so sentinel doesn't mis-score
          updated_by: authData.user.id,
          season_number: seedSeason
        })
        return
      }

      const expectedTokens = cohortFallback
        ? Math.ceil(cohortTokens as number)
        : Math.ceil(hp / (avgDamage as number))
      if (!Number.isFinite(expectedTokens) || expectedTokens <= 0) {
        diagnostics.push({
          slot: `${slot.main_boss_type} ${levelCode} enc${slot.encounter_id}`,
          reason: 'nonpositive_tokens'
        })
        return
      }

      const fallbackLabel = cohortFallback
        ? ` (cohort ${levelCode} mean)`
        : fallbackFromSet !== null
          ? ` (fallback from ${slot.rarity === 'Mythic' ? 'M' : 'L'}${fallbackFromSet})`
          : ''

      rowsToUpsert.push({
        guild_code: guildCode,
        boss_name: slot.main_boss_type,
        rarity: slot.rarity,
        set: slot.set,
        encounter_id: slot.encounter_id,
        target_tokens: expectedTokens,
        source: 'historical_seed',
        seeded_from_seasons: `${seededFromSeasons}${fallbackLabel}`,
        skip: false,
        updated_by: authData.user.id,
        season_number: seedSeason
      })
    })

    if (rowsToUpsert.length === 0) {
      return NextResponse.json({
        rows_written: 0,
        note: 'No historical data for this guild in the seed window',
        diagnostics
      })
    }

    // Scoped to the seeded season so another season's manual row does not block.
    const targetsTable = supabase.from('boss_target_tokens')
    const { data: existing, error: existingErr } = await targetsTable
      .select('boss_name, rarity, set, encounter_id, source')
      .eq('guild_code', guildCode)
      .eq('season_number', seedSeason)
    if (existingErr) {
      logger.error(
        { guildCode, seedSeason, error: existingErr },
        'boss_target_tokens seed: manual-row preservation query failed'
      )
      throw Errors.fromStatus(500, 'Failed to preserve manual targets', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }
    const manualKeys = new Set<string>()
    ;(
      existing as Array<{
        boss_name: string
        rarity: string
        set: number
        encounter_id: number
        source: string
      }> | null
    )?.forEach((r) => {
      if (r.source === 'officer_manual')
        manualKeys.add(
          `${r.boss_name}__${r.rarity}__${r.set}__${r.encounter_id ?? 0}`
        )
    })
    const filtered = rowsToUpsert.filter(
      (r) =>
        !manualKeys.has(
          `${r.boss_name}__${r.rarity}__${r.set}__${r.encounter_id}`
        )
    )

    if (filtered.length === 0) {
      return NextResponse.json({
        rows_written: 0,
        rows_preserved: manualKeys.size,
        note: 'All rows already officer-manual'
      })
    }

    // Wipe this guild+season's seeds first; officer_manual rows and other seasons are untouched.
    const { error: wipeErr } = await targetsTable
      .delete()
      .eq('guild_code', guildCode)
      .eq('source', 'historical_seed')
      .eq('season_number', seedSeason)
    if (wipeErr) {
      logger.error(
        { guildCode, error: wipeErr },
        'boss_target_tokens seed: wipe stale seed rows failed'
      )
      throw Errors.fromStatus(500, 'Failed to clear stale seed rows', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }

    const { data, error } = await targetsTable
      .upsert(filtered, {
        onConflict: 'guild_code,boss_name,rarity,set,encounter_id,season_number'
      })
      .select()
    if (error) {
      logger.error(
        { guildCode, rows: filtered.length, error },
        'boss_target_tokens seed upsert failed'
      )
      throw Errors.fromStatus(500, 'Failed to seed targets', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }

    const writtenRows =
      (data as Array<{
        boss_name: string
        rarity: string
        set: number
        encounter_id: number
      }> | null) ?? []
    const currentCoverage = writtenRows.length
    const currentTotalSlots = currentSlots.size

    return NextResponse.json({
      rows_written: writtenRows.length,
      rows_preserved: manualKeys.size,
      seeded_from_seasons: seededFromSeasons,
      current_rotation_covered: currentCoverage,
      current_rotation_total_slots: currentTotalSlots,
      diagnostics
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in boss-target-tokens POST seed:')
    throw Errors.fromStatus(500, 'Internal error', { code: 'INTERNAL_ERROR' })
  }
})
