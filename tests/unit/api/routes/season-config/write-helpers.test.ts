import { describe, expect, it, vi } from 'vitest'

import {
  SEASON_CONFIG_NOTES_MAX_LEN,
  SEASON_CONFIG_PENDING_BOSS_NAME,
  mergeSeasonConfigSubBossPatch,
  normalizeSeasonConfigKillThresholdPct,
  normalizeSeasonConfigNoteField,
  normalizeSeasonConfigPingMode,
  normalizeSeasonConfigRaritySet,
  normalizeSeasonConfigStringField,
  normalizeSeasonConfigSubIndex
} from '@/app/api/season-config/_write-helpers'

interface PlannerRow {
  id: string
  sub_bosses: Record<string, unknown> | null
  boss_name: string
}

const baseInput = {
  guild_code: 'AAAA',
  season_number: '5',
  level: 'L4'
}

const buildSupabase = ({
  existingRow = {
    id: 'row-1',
    sub_bosses: { sub1: 'Magnus', target_tokens: 10 },
    boss_name: 'Magnus'
  } as PlannerRow | null,
  lookupError = null as { message: string } | null,
  updateError = null as { message: string; code?: string } | null,
  // .select('id') makes a zero-row (RLS-filtered) update an error, not silent success.
  updatedRows = undefined as Array<{ id: string }> | undefined,
  insertError = null as { message: string; code?: string } | null
} = {}) => {
  const eqSpy = vi.fn().mockReturnThis()
  const limitSpy = vi.fn().mockResolvedValue({
    data: existingRow ? [existingRow] : [],
    error: lookupError
  })
  const updateSelectSpy = vi.fn().mockResolvedValue({
    data:
      updatedRows ??
      (updateError ? null : existingRow ? [{ id: existingRow.id }] : []),
    error: updateError
  })
  const updateEqSpy = vi.fn().mockReturnValue({ select: updateSelectSpy })
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy })
  const insertSpy = vi.fn().mockResolvedValue({ error: insertError })
  const table = {
    select: vi.fn().mockReturnValue({ eq: eqSpy, limit: limitSpy }),
    update: updateSpy,
    insert: insertSpy
  }
  const supabase = {
    from: vi.fn().mockReturnValue(table)
  }

  return {
    supabase,
    table,
    eqSpy,
    limitSpy,
    updateSpy,
    updateEqSpy,
    updateSelectSpy,
    insertSpy
  }
}

describe('season config write helpers', () => {
  describe('mergeSeasonConfigSubBossPatch — atomic RPC path (WI-4880)', () => {
    it('uses merge_season_boss_sub_bosses when the client can rpc, and never reads the table', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: {}, error: null })
      const from = vi.fn()
      await mergeSeasonConfigSubBossPatch({
        supabase: { rpc, from },
        selectedBy: 'user-1',
        input: { guild_code: 'G', season_number: '103', level: 'M1' },
        patch: { sub1_skip: true, sub1_kill_threshold_pct: 60 },
        endpoint: '/t',
        lookupFailureMessage: 'l',
        updateFailureMessage: 'u',
        insertFailureMessage: 'i'
      })
      expect(rpc).toHaveBeenCalledWith('merge_season_boss_sub_bosses', {
        p_guild_code: 'G',
        p_season_number: '103',
        p_level: 'M1',
        p_patch: { sub1_skip: true, sub1_kill_threshold_pct: 60 },
        p_selected_by: 'user-1'
      })
      expect(from).not.toHaveBeenCalled()
    })

    it('falls back to the legacy merge ONLY on PGRST202 (function not deployed)', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'missing' }
      })
      const { supabase, insertSpy } = buildSupabase({ existingRow: null })
      await mergeSeasonConfigSubBossPatch({
        supabase: { ...supabase, rpc },
        selectedBy: 'user-1',
        input: { guild_code: 'G', season_number: '103', level: 'M1' },
        patch: { sub1_skip: true },
        endpoint: '/t',
        lookupFailureMessage: 'l',
        updateFailureMessage: 'u',
        insertFailureMessage: 'i'
      })
      expect(insertSpy).toHaveBeenCalled()
    })

    it('surfaces any other RPC error instead of silently falling back', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'denied' }
      })
      const from = vi.fn()
      await expect(
        mergeSeasonConfigSubBossPatch({
          supabase: { rpc, from },
          selectedBy: 'user-1',
          input: { guild_code: 'G', season_number: '103', level: 'M1' },
          patch: { sub1_skip: true },
          endpoint: '/t',
          lookupFailureMessage: 'l',
          updateFailureMessage: 'u',
          insertFailureMessage: 'i'
        })
      ).rejects.toThrow()
      expect(from).not.toHaveBeenCalled()
    })
  })

  it('normalizes shared route input primitives without widening contracts', () => {
    expect(normalizeSeasonConfigStringField('  AAAA  ')).toBe('AAAA')
    expect(normalizeSeasonConfigStringField(123)).toBe('')

    expect(normalizeSeasonConfigRaritySet('L1')).toBe('L1')
    expect(normalizeSeasonConfigRaritySet('M5')).toBe('M5')
    expect(normalizeSeasonConfigRaritySet('l1')).toBe('')
    expect(normalizeSeasonConfigRaritySet('L6')).toBe('')

    expect(normalizeSeasonConfigSubIndex(1)).toBe(1)
    expect(normalizeSeasonConfigSubIndex(2)).toBe(2)
    expect(normalizeSeasonConfigSubIndex('1')).toBeNull()
    expect(normalizeSeasonConfigSubIndex(3)).toBeNull()

    expect(normalizeSeasonConfigKillThresholdPct(0)).toBe(0)
    expect(normalizeSeasonConfigKillThresholdPct('12.5')).toBe(12.5)
    expect(normalizeSeasonConfigKillThresholdPct('12abc')).toBe(12)
    expect(normalizeSeasonConfigKillThresholdPct(-1)).toBeNull()
    expect(normalizeSeasonConfigKillThresholdPct(101)).toBeNull()

    expect(normalizeSeasonConfigPingMode('combined')).toBe('combined')
    expect(normalizeSeasonConfigPingMode('per_side')).toBe('per_side')
    expect(normalizeSeasonConfigPingMode(null)).toBeNull()
    expect(normalizeSeasonConfigPingMode('invalid')).toBeUndefined()
  })

  it('normalizes notes fields with existing undefined/null/truncation behavior', () => {
    const longNote = 'x'.repeat(SEASON_CONFIG_NOTES_MAX_LEN + 20)

    expect(normalizeSeasonConfigNoteField(undefined)).toBeUndefined()
    expect(normalizeSeasonConfigNoteField(null)).toBeNull()
    expect(normalizeSeasonConfigNoteField(42)).toBeUndefined()
    expect(normalizeSeasonConfigNoteField(' keep spacing ')).toBe(
      ' keep spacing '
    )
    expect(normalizeSeasonConfigNoteField(longNote)).toHaveLength(
      SEASON_CONFIG_NOTES_MAX_LEN
    )
  })

  // A stored "" would shadow the fallback note in a `??` read.
  it("coerces '' and whitespace-only notes to null (WI-4950 C4)", () => {
    expect(normalizeSeasonConfigNoteField('')).toBeNull()
    expect(normalizeSeasonConfigNoteField('   ')).toBeNull()
    expect(normalizeSeasonConfigNoteField('\n\t ')).toBeNull()
    expect(normalizeSeasonConfigNoteField(' a ')).toBe(' a ')
  })

  // An omitted key is a no-op in the `coalesce(sub_bosses,'{}') || patch` merge.
  it('a cleared note builds a patch with an explicit null key, not an omitted one (mirrors notes-mode/route.ts)', () => {
    const buildPatch = (mainNotesRaw: unknown) => {
      const mainNotes = normalizeSeasonConfigNoteField(mainNotesRaw)
      const patch: Record<string, unknown> = {}
      if (mainNotes !== undefined) patch.main_notes = mainNotes
      return patch
    }

    const clearedPatch = buildPatch('')
    expect(clearedPatch).toHaveProperty('main_notes')
    expect(clearedPatch.main_notes).toBeNull()

    const untouchedPatch = buildPatch(undefined)
    expect(untouchedPatch).not.toHaveProperty('main_notes')
  })

  it('updates an existing planner row by merging the supplied sub_bosses patch', async () => {
    const { supabase, updateSpy, updateEqSpy, insertSpy } = buildSupabase()

    await mergeSeasonConfigSubBossPatch({
      supabase,
      selectedBy: 'user-123',
      input: baseInput,
      patch: { sub1_skip: true },
      endpoint: '/api/season-config/skip-prime',
      lookupFailureMessage: 'lookup failed',
      updateFailureMessage: 'update failed',
      insertFailureMessage: 'insert failed'
    })

    expect(updateSpy).toHaveBeenCalledWith({
      selected_by: 'user-123',
      sub_bosses: {
        sub1: 'Magnus',
        target_tokens: 10,
        sub1_skip: true
      }
    })
    expect(updateEqSpy).toHaveBeenCalledWith('id', 'row-1')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('inserts a sentinel planner row when no row exists yet', async () => {
    const { supabase, insertSpy, updateSpy } = buildSupabase({
      existingRow: null
    })

    await mergeSeasonConfigSubBossPatch({
      supabase,
      selectedBy: 'user-123',
      input: {
        ...baseInput,
        sub_index: 2,
        kill_threshold_pct: 25
      },
      patch: { sub2_kill_threshold_pct: 25 },
      endpoint: '/api/season-config/kill-threshold',
      lookupFailureMessage: 'lookup failed',
      updateFailureMessage: 'update failed',
      insertFailureMessage: 'insert failed'
    })

    expect(updateSpy).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith({
      ...baseInput,
      boss_name: SEASON_CONFIG_PENDING_BOSS_NAME,
      selected_by: 'user-123',
      sub_bosses: { sub2_kill_threshold_pct: 25 }
    })
    expect(insertSpy.mock.calls[0][0]).not.toHaveProperty('sub_index')
    expect(insertSpy.mock.calls[0][0]).not.toHaveProperty('kill_threshold_pct')
  })

  describe('RLS denial mapping (WI-4950)', () => {
    it('maps an RPC-path 42501 to a 403-shaped forbidden error', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied' }
      })
      await expect(
        mergeSeasonConfigSubBossPatch({
          supabase: { rpc, from: vi.fn() },
          selectedBy: 'user-1',
          input: { guild_code: 'G', season_number: '103', level: 'M1' },
          patch: { main_notes: 'x' },
          endpoint: '/t',
          lookupFailureMessage: 'l',
          updateFailureMessage: 'u',
          insertFailureMessage: 'i'
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        message: expect.stringContaining('Not authorized'),
        metadata: expect.objectContaining({
          endpoint: '/t',
          details: expect.not.stringContaining('permission denied')
        })
      })
    })

    it('keeps raw DB error strings out of the RPC-path 500 metadata', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "upcoming_season_bosses_pkey"'
        }
      })
      await expect(
        mergeSeasonConfigSubBossPatch({
          supabase: { rpc, from: vi.fn() },
          selectedBy: 'user-1',
          input: { guild_code: 'G', season_number: '103', level: 'M1' },
          patch: { main_notes: 'x' },
          endpoint: '/t',
          lookupFailureMessage: 'l',
          updateFailureMessage: 'u',
          insertFailureMessage: 'i'
        })
      ).rejects.toMatchObject({
        message: 'u',
        metadata: expect.objectContaining({
          endpoint: '/t',
          details: expect.not.stringContaining('constraint')
        })
      })
    })

    it('maps a fallback-UPDATE row-level-security message to a 403', async () => {
      const { supabase } = buildSupabase({
        updateError: {
          message: 'new row violates row-level security policy'
        }
      })
      await expect(
        mergeSeasonConfigSubBossPatch({
          supabase,
          selectedBy: 'user-1',
          input: baseInput,
          patch: { main_notes: 'x' },
          endpoint: '/api/season-config/notes-mode',
          lookupFailureMessage: 'l',
          updateFailureMessage: 'u',
          insertFailureMessage: 'i'
        })
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('maps a fallback-INSERT 42501 to a 403', async () => {
      const { supabase } = buildSupabase({
        existingRow: null,
        insertError: { code: '42501', message: 'permission denied' }
      })
      await expect(
        mergeSeasonConfigSubBossPatch({
          supabase,
          selectedBy: 'user-1',
          input: baseInput,
          patch: { main_notes: 'x' },
          endpoint: '/api/season-config/notes-mode',
          lookupFailureMessage: 'l',
          updateFailureMessage: 'u',
          insertFailureMessage: 'i'
        })
      ).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  // A zero-row UPDATE is how RLS denies without raising.
  it('maps a zero-row fallback UPDATE to a 403 RLS-denial error', async () => {
    const { supabase, updateSelectSpy } = buildSupabase({ updatedRows: [] })

    await expect(
      mergeSeasonConfigSubBossPatch({
        supabase,
        selectedBy: 'user-1',
        input: baseInput,
        patch: { sub1_skip: true },
        endpoint: '/api/season-config/skip-prime',
        lookupFailureMessage: 'lookup failed',
        updateFailureMessage: 'update failed',
        insertFailureMessage: 'insert failed'
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('Not authorized'),
      metadata: expect.objectContaining({
        endpoint: '/api/season-config/skip-prime',
        details: expect.stringContaining('0 rows')
      })
    })
    expect(updateSelectSpy).toHaveBeenCalledWith('id')
  })

  it('wraps planner-row write failures in route-specific update errors', async () => {
    const { supabase } = buildSupabase({
      updateError: { message: 'permission denied' }
    })

    await expect(
      mergeSeasonConfigSubBossPatch({
        supabase,
        selectedBy: 'user-123',
        input: baseInput,
        patch: { sub1_skip: false },
        endpoint: '/api/season-config/skip-prime',
        lookupFailureMessage: 'lookup failed',
        updateFailureMessage: 'update failed',
        insertFailureMessage: 'insert failed'
      })
    ).rejects.toMatchObject({
      message: 'update failed',
      metadata: expect.objectContaining({
        endpoint: '/api/season-config/skip-prime',
        details: 'permission denied'
      })
    })
  })
})
