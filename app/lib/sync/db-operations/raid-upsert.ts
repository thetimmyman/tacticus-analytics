import type { ProcessedRaidEntry } from '@/app/lib/sync/transformers'
import { withoutWriteClock } from '@/supabase/functions/_shared/sync-modules/helpers'
import {
  logger,
  getErrorMessage,
  isRecentTimestamp,
  BATCH_CONFIG,
  type StrictSupabaseClient
} from '@/app/lib/sync/db-operations/shared'

export type UpsertResult = {
  upserted: number
  inserted: number
  updated: number
  errors: number
}

export async function upsertDataBatches(
  supabase: StrictSupabaseClient,
  guildCode: string,
  data: ProcessedRaidEntry[]
): Promise<UpsertResult> {
  if (!data || data.length === 0) {
    return { upserted: 0, inserted: 0, updated: 0, errors: 0 }
  }

  let upserted = 0
  let inserted = 0
  let updated = 0
  let errors = 0

  const validData = data.filter((entry) => {
    return (
      entry.Guild &&
      entry.Season &&
      typeof entry.Guild === 'string' &&
      typeof entry.Season === 'string'
    )
  })

  if (validData.length !== data.length) {
    logger.warn(
      { guildCode },
      `Filtered out ${data.length - validData.length} invalid records`
    )
  }

  logger.info({ guildCode }, `Starting upsert of ${validData.length} records`)
  const startTime = Date.now()

  for (let i = 0; i < validData.length; i += BATCH_CONFIG.batchSize) {
    const batch = validData.slice(i, i + BATCH_CONFIG.batchSize)
    const batchStartTime = Date.now()

    try {
      const { data: upsertedData, error } = await supabase
        .from('EOT_GR_data')
        .upsert(batch.map(withoutWriteClock), {
          onConflict:
            'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
          defaultToNull: false
        })
        .select('id, timestamp')

      if (error) {
        logger.warn(
          { guildCode },
          `Batch upsert failed: ${error.message}, trying individual inserts`
        )

        for (const record of batch) {
          try {
            const { data: singleData, error: singleError } = await supabase
              .from('EOT_GR_data')
              .upsert([withoutWriteClock(record)], {
                onConflict:
                  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType'
              })
              .select('id, timestamp')

            if (!singleError && singleData && singleData.length > 0) {
              upserted++
              const isNew = isRecentTimestamp(singleData[0]?.timestamp)
              if (isNew) inserted++
              else updated++
            } else {
              errors++
              logger.warn(
                {
                  guildCode,
                  key: {
                    Guild: record.Guild,
                    Season: record.Season,
                    userId: record.userId,
                    encounterId: record.encounterId,
                    startedOn: record.startedOn,
                    completedOn: record.completedOn,
                    damageDealt: record.damageDealt,
                    damageType: record.damageType
                  },
                  // Never log Postgres `details`: it can hold the whole row,
                  // including player names the sanitizer cannot redact.
                  code: singleError?.code
                },
                `Single-row retry failed, row dropped: ${singleError?.message ?? 'no data returned'}`
              )
            }
          } catch {
            errors++
          }
        }
      } else if (upsertedData) {
        upserted += upsertedData.length
        for (const item of upsertedData) {
          const isNew = isRecentTimestamp(item?.timestamp)
          if (isNew) inserted++
          else updated++
        }
      }

      const batchTime = Date.now() - batchStartTime
      logger.info(
        { guildCode },
        `Batch ${Math.floor(i / BATCH_CONFIG.batchSize) + 1} upsert (${batchTime}ms) - ${batch.length} records`
      )

      if (i + BATCH_CONFIG.batchSize < validData.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, BATCH_CONFIG.batchDelay)
        )
      }
    } catch (error: unknown) {
      errors += batch.length
      logger.error(
        { guildCode },
        `Exception processing batch: ${getErrorMessage(error)}`
      )
    }
  }

  const totalTime = Date.now() - startTime
  logger.info(
    { guildCode },
    `Upsert complete: ${upserted}/${validData.length} successful (${inserted} new, ${updated} updated, ${errors} errors) in ${totalTime}ms`
  )

  return { upserted, inserted, updated, errors }
}
