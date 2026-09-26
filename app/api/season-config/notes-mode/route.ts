import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import {
  normalizeSeasonConfigNoteField,
  normalizeSeasonConfigPingMode,
  normalizeSeasonConfigBaseInput,
  type SeasonConfigPingMode
} from '../_write-helpers'
import {
  authorizeSeasonConfigWrite,
  persistSeasonConfigPatch
} from '../_write-route'

const logger = createComponentLogger('season-config-notes-mode')

// herald_boss_config is not season-scoped, so these live in sub_bosses. Absent fields are kept, null clears.

interface NotesModeInput {
  guild_code: string
  season_number: string
  level: string
  main_notes?: string | null
  side1_notes?: string | null
  side2_notes?: string | null
  ping_mode?: SeasonConfigPingMode | null
}

const normalizeInput = (body: unknown): NotesModeInput | null => {
  const normalized = normalizeSeasonConfigBaseInput(body)
  if (!normalized) return null
  const { input, raw } = normalized
  return {
    ...input,
    main_notes: normalizeSeasonConfigNoteField(raw.main_notes),
    side1_notes: normalizeSeasonConfigNoteField(raw.side1_notes),
    side2_notes: normalizeSeasonConfigNoteField(raw.side2_notes),
    ping_mode: normalizeSeasonConfigPingMode(raw.ping_mode)
  }
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const endpoint = '/api/season-config/notes-mode'
  const { input, supabase, user } = await authorizeSeasonConfigWrite(req, {
    endpoint,
    normalizeInput,
    validationMessage:
      'guild_code, season_number, and level (L1..M5) are required; at least one of main_notes / side1_notes / side2_notes / ping_mode must be provided'
  })
  if (
    input.main_notes === undefined &&
    input.side1_notes === undefined &&
    input.side2_notes === undefined &&
    input.ping_mode === undefined
  ) {
    throw Errors.validation(
      'at least one of main_notes / side1_notes / side2_notes / ping_mode must be provided',
      { endpoint }
    )
  }

  const patch: Record<string, unknown> = {}
  if (input.main_notes !== undefined) patch.main_notes = input.main_notes
  if (input.side1_notes !== undefined) patch.side1_notes = input.side1_notes
  if (input.side2_notes !== undefined) patch.side2_notes = input.side2_notes
  if (input.ping_mode !== undefined) patch.ping_mode = input.ping_mode
  await persistSeasonConfigPatch({
    endpoint,
    supabase,
    selectedBy: user.id,
    input,
    patch,
    failures: {
      lookup: 'Failed to look up existing season row',
      update: 'Failed to update notes/ping_mode',
      insert: 'Failed to create season row for notes/ping_mode'
    }
  })

  logger.info(
    {
      guild_code: input.guild_code,
      season_number: input.season_number,
      level: input.level,
      fields_set: {
        main_notes: input.main_notes !== undefined,
        side1_notes: input.side1_notes !== undefined,
        side2_notes: input.side2_notes !== undefined,
        ping_mode: input.ping_mode !== undefined
      }
    },
    'season_config.notes_mode.saved'
  )
  return NextResponse.json({ success: true })
})
