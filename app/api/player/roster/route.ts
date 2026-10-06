import {
  expectedErrorResponse,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, after } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import {
  tacticusAPI,
  resolveMachinesOfWar,
  type TacticusPlayer
} from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.player.roster')
import { getUnitCatalog, type UnitCatalog } from '@/app/lib/player/unit-catalog'
import {
  AppError,
  ErrorCode,
  Errors,
  rethrowIfAppError
} from '@/app/lib/errors/AppError'
import { persistRosterSnapshot } from '@/app/lib/player/roster-sync'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'
import { GAME_DATA_ROOT } from '@/app/lib/data/game-data-root'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { readOwnRosterCache } from '@/app/lib/desktop/roster-cache'

const normalizeUnitKey = normalizeIdentifier

const resolveEngineUnitId = (unitId: string, catalog: UnitCatalog) => {
  const trimmed = unitId.trim()
  if (!trimmed) return null
  if (catalog.heroes.has(trimmed) || catalog.mows.has(trimmed)) return trimmed
  const key = normalizeUnitKey(trimmed)
  const mapped = key ? catalog.aliases?.get(key) : undefined
  return mapped ?? trimmed
}

const classifyUnitId = (engineId: string | null, catalog: UnitCatalog) => {
  if (!engineId) return 'unknown'
  if (catalog.mows.has(engineId)) return 'mow'
  if (catalog.heroes.has(engineId)) return 'hero'
  return 'unknown'
}

const enrichUnit = (unit: any, catalog: UnitCatalog) => {
  const rawId = typeof unit?.id === 'string' ? unit.id : String(unit?.id ?? '')
  const engineId = resolveEngineUnitId(rawId, catalog)
  const category = classifyUnitId(engineId, catalog)
  const display = engineId ? catalog.display?.get(engineId) : undefined
  return { ...display, ...unit, engineId, category }
}

const mergeMowLists = (lists: Array<Array<any>>) => {
  const merged: any[] = []
  const seen = new Set<string>()
  lists.forEach((items) => {
    items.forEach((unit) => {
      const key = String(unit?.engineId ?? unit?.id ?? '').trim()
      if (!key || seen.has(key)) return
      seen.add(key)
      merged.push(unit)
    })
  })
  return merged
}

async function enrichRoster(player: TacticusPlayer | Record<string, unknown>) {
  const machinesOfWar = resolveMachinesOfWar(player)

  const unitsRaw = Array.isArray(player.units) ? player.units : []
  let units = unitsRaw
  let resolvedMows = machinesOfWar.length > 0 ? machinesOfWar : undefined
  let unitCatalog: UnitCatalog | null = null
  try {
    unitCatalog = await getUnitCatalog(GAME_DATA_ROOT)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Unit catalog load failed for roster enrichment')
  }

  if (unitCatalog) {
    const enrichedUnits = unitsRaw.map((unit) => enrichUnit(unit, unitCatalog))
    const apiMows =
      machinesOfWar.length > 0
        ? machinesOfWar.map((unit: any) => {
            const enriched = enrichUnit(unit, unitCatalog)
            return enriched.category === 'mow'
              ? enriched
              : { ...enriched, category: 'mow' }
          })
        : []
    const derivedMows = enrichedUnits.filter((unit) => unit.category === 'mow')
    const mergedMows = mergeMowLists([apiMows, derivedMows])
    units = enrichedUnits
    resolvedMows = mergedMows.length > 0 ? mergedMows : undefined
  }

  return { unitsRaw, machinesOfWar, units, resolvedMows }
}

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async () => {
  const supabase = await db()

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser()
  if (authError || !user) {
    throw Errors.unauthorized('Authentication required')
  }
  await assertUnbannedAuthUser(user)

  if (getRuntimeProfile() === 'desktop') {
    const cached = await readOwnRosterCache(supabase, user.id)
    if (!cached)
      return NextResponse.json({
        success: true,
        cachePresent: false,
        units: [],
        machinesOfWar: []
      })
    const { units, resolvedMows } = await enrichRoster({
      units: cached.units,
      machinesOfWar: cached.machinesOfWar
    })
    return NextResponse.json({
      success: true,
      cachePresent: true,
      playerName: cached.playerName,
      powerLevel: cached.powerLevel,
      units,
      machinesOfWar: resolvedMows,
      progress: {},
      cachedAt: cached.cachedAt,
      source: cached.source
    })
  }

  // The authenticated role cannot read tacticus_api_key_encrypted.
  const { data: profile } = await serviceDb()
    .from('player_mapping')
    .select('id, tacticus_api_key_encrypted')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (!profile?.tacticus_api_key_encrypted) {
    throw Errors.validation('Player API key not configured', {
      code: 'NO_API_KEY'
    })
  }

  const apiKey = await getPlayerApiKey(profile)
  if (!apiKey) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      'Failed to decrypt API key',
      500,
      false,
      { code: 'DECRYPT_FAILED' }
    )
  }

  // Retries absorb transient DNS failures (EAI_AGAIN).
  const player = await tacticusAPI.getPlayerWithRetry(apiKey)
  if (!player) {
    // Expected (revoked key or circuit open): warn, not Sentry.
    logger.warn(
      {
        apiKeyLength: apiKey.length
      },
      'Tacticus API returned null for player'
    )
    return expectedErrorResponse(
      new AppError(
        ErrorCode.EXTERNAL_API_ERROR,
        'Failed to fetch player data from Tacticus API. Please verify your API key is valid.',
        502,
        true,
        { code: 'API_FAILED' }
      )
    )
  }

  const { unitsRaw, machinesOfWar, units, resolvedMows } =
    await enrichRoster(player)

  const mowsForPersist = machinesOfWar
  after(() =>
    persistRosterSnapshot(
      user.id,
      unitsRaw,
      mowsForPersist,
      supabase,
      typeof profile.id === 'number' ? profile.id : undefined,
      { playerPower: player.details?.powerLevel ?? null }
    ).catch((err) => {
      logger.warn(
        { error: err?.message ?? err },
        '[Roster] Persist snapshot failed (non-blocking)'
      )
    })
  )

  return NextResponse.json({
    success: true,
    playerName: player.details?.name,
    powerLevel: player.details?.powerLevel,
    units,
    machinesOfWar: resolvedMows,
    progress: player.progress || {}
  })
})
