import { processTimestamp } from './helpers.ts'

export interface Logger {
  info: (ctx: string, msg: string) => void
  warn: (ctx: string, msg: string) => void
  error: (ctx: string, msg: string, err?: unknown) => void
  debug: (ctx: string, msg: string) => void
}

export interface DbWriterDeps {
  supabase: any
  logger: Logger
}

export interface BombUpdate {
  player_id: string
  guild: string
  display_name: string
  last_used: string
}

// The producer (transforms.ts) owns this shape; re-exported so both sides agree.
import type { ProcessedRaidEntry } from './transforms.ts'
export type { ProcessedRaidEntry }

/** Non-reversible FNV-1a token to correlate failures without logging the raw id (edge logs are unsanitized). */
export function pseudonymizeId(value: unknown): string {
  const input = value === null || value === undefined ? '' : String(value)
  if (input === '') return 'anon'
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `p_${hash.toString(16).padStart(8, '0')}`
}

export async function updateBombTracking(
  deps: DbWriterDeps,
  config: { table: string },
  entries: any[],
  guildCode: string,
  playerMappings: Record<string, string>
) {
  const bombUpdates: BombUpdate[] = []

  for (const entry of entries) {
    const isBombEntry =
      entry.damageType === 'Bomb' ||
      (entry.userId && entry.damageDealt !== undefined && !entry.damageType)
    if (!isBombEntry || !entry.userId) continue

    const loweredId = entry.userId.toLowerCase()
    const displayName =
      playerMappings[entry.userId] ||
      playerMappings[loweredId] ||
      entry.userId ||
      ''
    const damage =
      typeof entry.damageDealt === 'number'
        ? entry.damageDealt
        : Number(entry.damageDealt)

    if (!displayName || displayName === 'Unknown') continue
    if (!Number.isFinite(damage) || damage <= 0) continue

    bombUpdates.push({
      player_id: entry.userId,
      guild: guildCode,
      display_name: displayName,
      last_used: processTimestamp(entry.completedOn || entry.startedOn)
    })
  }

  if (bombUpdates.length === 0) return

  const latestBombs: Record<string, BombUpdate> = {}
  for (const bomb of bombUpdates) {
    const key = `${bomb.guild}:${bomb.player_id}`
    if (
      !latestBombs[key] ||
      new Date(bomb.last_used) > new Date(latestBombs[key].last_used)
    ) {
      latestBombs[key] = bomb
    }
  }

  const finalBombUpdates = Object.values(latestBombs)

  try {
    const { error } = await deps.supabase
      .from(config.table)
      .upsert(finalBombUpdates, { onConflict: 'player_id,guild' })

    if (!error) {
      deps.logger.info(
        guildCode,
        `Updated bomb tracking for ${finalBombUpdates.length} players`
      )
    } else {
      deps.logger.warn(
        guildCode,
        `Failed to update bomb tracking: ${error.message}`
      )
    }
  } catch (error) {
    deps.logger.error(guildCode, `Exception updating bomb tracking`, error)
  }
}

export async function upsertDataBatches(
  deps: DbWriterDeps,
  config: { table: string; batchSize: number },
  guildCode: string,
  data: ProcessedRaidEntry[],
  validateData: (entry: ProcessedRaidEntry, guildCode: string) => boolean
): Promise<{
  upserted: number
  inserted: number
  updated: number
  errors: number
}> {
  if (!data || data.length === 0) {
    return { upserted: 0, inserted: 0, updated: 0, errors: 0 }
  }

  let upserted = 0
  let inserted = 0
  let updated = 0
  let errors = 0

  const validData = data.filter((entry) => validateData(entry, guildCode))

  errors += data.length - validData.length

  if (validData.length !== data.length) {
    deps.logger.warn(
      guildCode,
      `Filtered out ${data.length - validData.length} invalid records`
    )
  }

  const batchSize = config.batchSize
  const totalBatches = Math.ceil(validData.length / batchSize)
  deps.logger.info(
    guildCode,
    `Starting upsert: ${validData.length} records in ${totalBatches} batches of ${batchSize}`
  )

  for (let i = 0; i < validData.length; i += batchSize) {
    const batch = validData.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1

    try {
      const batchStart = Date.now()
      const { error, count } = await deps.supabase
        .from(config.table)
        .upsert(batch, {
          onConflict:
            'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
          defaultToNull: false,
          count: 'exact'
        })

      const batchDuration = Date.now() - batchStart
      if (error) {
        // One poison row fails the batch; retry row-by-row so only bad rows are lost (as the app writer does).
        deps.logger.warn(
          guildCode,
          `Batch ${batchNum}/${totalBatches} failed (${batchDuration}ms): ${error.message}, retrying individual records`
        )

        for (const record of batch) {
          try {
            const { error: singleError, count: singleCount } =
              await deps.supabase.from(config.table).upsert([record], {
                onConflict:
                  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
                defaultToNull: false,
                count: 'exact'
              })

            if (singleError) {
              errors += 1
              // No PII sanitizer here: omit Guild (already in context) and pseudonymize userId.
              const key = `Season=${record.Season} user=${pseudonymizeId(record.userId)} encounterId=${record.encounterId} startedOn=${record.startedOn} completedOn=${record.completedOn} damageDealt=${record.damageDealt} damageType=${record.damageType}`
              const codeSuffix = singleError.code
                ? ` (code: ${singleError.code})`
                : ''
              // Postgres `details` can echo the whole row (display names); log only SQLSTATE and message.
              deps.logger.warn(
                guildCode,
                `Single-row retry failed, row dropped [${key}]: ${singleError.message}${codeSuffix}`
              )
            } else {
              const affectedCount =
                Number.isSafeInteger(singleCount) && singleCount >= 0
                  ? singleCount
                  : 0
              if (affectedCount !== 1) errors += 1
              upserted += affectedCount
              inserted += affectedCount
            }
          } catch {
            errors += 1
          }
        }
      } else {
        const affectedCount =
          Number.isSafeInteger(count) && count >= 0 ? count : 0
        if (affectedCount !== batch.length)
          errors += Math.max(1, batch.length - affectedCount)
        upserted += affectedCount
        inserted += affectedCount
        deps.logger.info(
          guildCode,
          `Batch ${batchNum}/${totalBatches} done (${batchDuration}ms): ${affectedCount} rows`
        )
      }
    } catch (error) {
      deps.logger.error(
        guildCode,
        `Batch ${batchNum}/${totalBatches} exception`,
        error
      )
      errors += batch.length
    }
  }

  return { upserted, inserted, updated, errors }
}
