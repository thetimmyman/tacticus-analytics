import 'server-only'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.boss-assignments.progression-config')

export { type ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'

import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import { getSeasonProgressionConfig } from '@/app/lib/loki/season-configs'

function validateProgressionConfig(
  config: ProgressionConfig,
  source: string
): ProgressionConfig {
  const fail = (message: string): never => {
    throw new Error(`Invalid ${source} progression config: ${message}`)
  }
  const validateSequence = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value)) {
      return fail(`${field} must contain at least one stage`)
    }
    const rawStages: unknown[] = value
    if (rawStages.length === 0) {
      return fail(`${field} must contain at least one stage`)
    }
    const stages = rawStages.map((stage, index) => {
      if (typeof stage !== 'string') {
        return fail(`${field}[${index}] must be a nonblank trimmed stage code`)
      }
      if (stage.trim() === '' || stage !== stage.trim()) {
        return fail(`${field}[${index}] must be a nonblank trimmed stage code`)
      }
      return stage
    })
    if (new Set(stages).size !== stages.length) {
      fail(`${field} must not contain duplicate stages`)
    }
    return stages
  }

  const firstPassSequence = validateSequence(
    config.firstPassSequence,
    'firstPassSequence'
  )
  const loopSequence = validateSequence(config.loopSequence, 'loopSequence')
  if (
    typeof config.loopStartStage !== 'string' ||
    config.loopStartStage.trim() === '' ||
    config.loopStartStage !== config.loopStartStage.trim()
  ) {
    fail('loopStartStage must be a nonblank trimmed stage code')
  }
  if (config.loopStartStage !== loopSequence[0]) {
    fail('loopStartStage must equal the first loopSequence stage')
  }

  const firstPassStages = new Set(firstPassSequence)
  const missingLoopStage = loopSequence.find(
    (stage) => !firstPassStages.has(stage)
  )
  if (missingLoopStage) {
    fail(`loop stage ${missingLoopStage} is absent from firstPassSequence`)
  }

  return {
    firstPassSequence,
    loopSequence,
    loopStartStage: config.loopStartStage,
    gameVersion:
      typeof config.gameVersion === 'string' ? config.gameVersion : null
  }
}

function rowToConfig(
  row: {
    first_pass_sequence: unknown
    loop_sequence: unknown
    loop_start_stage: unknown
    game_version: unknown
  },
  source: string
): ProgressionConfig {
  return validateProgressionConfig(
    {
      firstPassSequence: row.first_pass_sequence as string[],
      loopSequence: row.loop_sequence as string[],
      loopStartStage: row.loop_start_stage as string,
      gameVersion:
        typeof row.game_version === 'string' ? row.game_version : null
    },
    source
  )
}

/** Throws when unresolved: a global fallback would advance guilds to the wrong boss. */
export async function getActiveProgressionConfig(
  guildCode: string | undefined,
  season: number,
  signedClient?: TypedSupabaseClient
): Promise<ProgressionConfig> {
  try {
    if (!Number.isFinite(season)) {
      throw new Error(
        'A finite season number is required to resolve progression config'
      )
    }

    if (guildCode) {
      const supabase = signedClient ?? serviceDb()
      const { data: guildConfig, error: guildConfigError } = await supabase
        .from('raid_progression_config')
        .select(
          'first_pass_sequence, loop_sequence, loop_start_stage, game_version'
        )
        .eq('scope', guildCode)
        .eq('is_active', true)
        .maybeSingle()

      if (guildConfigError) {
        throw new Error(
          `Failed to load guild progression config: ${guildConfigError.message}`
        )
      }

      if (guildConfig) {
        return rowToConfig(guildConfig, `guild override ${guildCode}`)
      }
    }

    const seasonConfig = getSeasonProgressionConfig(season)
    if (seasonConfig) {
      return validateProgressionConfig(
        seasonConfig,
        `captured season ${season}`
      )
    }

    throw new Error(
      `No captured progression config is available for season ${season}`
    )
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        guildCode,
        season
      },
      'Failed to resolve progression config'
    )
    throw error
  }
}
