'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { asEncounterId } from '@/app/lib/boss-ops/identity'
import { saveTargetToken } from '@/app/lib/boss-ops/persist-target-token'
import { deriveSeedState, targetRowKey, type MergedRow } from './model'

type TargetWrite = {
  boss_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
  target_tokens: number
  skip: boolean
}

type SeedResult = {
  rows_written: number
  rows_preserved?: number
  seeded_from_seasons?: string
  note?: string
  current_rotation_covered?: number
  current_rotation_total_slots?: number
}

export function describeSeedResult(body: SeedResult): string {
  if (body.note) return body.note
  const base = `Seeded ${body.rows_written} rows from ${body.seeded_from_seasons ?? 'history'}`
  const coverage =
    typeof body.current_rotation_covered === 'number' &&
    typeof body.current_rotation_total_slots === 'number'
      ? ` — ${body.current_rotation_covered}/${body.current_rotation_total_slots} of this season's slots covered (primes use tier-cohort averages)`
      : ''
  const preserved = body.rows_preserved
    ? ` (preserved ${body.rows_preserved} officer-set)`
    : ''
  return base + coverage + preserved
}

export function useTargetMutations({
  guildCode,
  selectedSeason,
  canEdit
}: {
  guildCode: string
  selectedSeason: string
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [seedStatus, setSeedStatus] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const invalidateTargets = () =>
    queryClient.invalidateQueries({
      queryKey: ['boss-target-tokens', guildCode]
    })

  const upsertMutation = useMutation({
    // `skip` is required: this page is the skip-aware writer (a committed target clears skip).
    mutationFn: async (input: TargetWrite) => {
      // Season-inclusive onConflict keeps writes off the '' legacy row.
      await saveTargetToken({
        bossType: input.boss_name,
        rarity: input.rarity,
        set: input.set,
        encounterId: asEncounterId(input.encounter_id),
        targetTokens: input.target_tokens,
        skip: input.skip,
        seasonNumber: selectedSeason,
        guildCode
      })
    },
    onSuccess: () => {
      setSaveError(null)
      void invalidateTargets()
      setEditingKey(null)
      setEditValue('')
    },
    // Surface the failure so a refused write does not look like a stuck Save.
    onError: (error) =>
      setSaveError(error instanceof Error ? error.message : 'Save failed')
  })

  const seedMutation = useMutation({
    mutationFn: async () => {
      // Seed the selected season (the server stamps season_number).
      const response = await fetch('/api/boss-assignments/target-tokens/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season: selectedSeason })
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<SeedResult>
    },
    onSuccess: (body) => {
      setSeedStatus(describeSeedResult(body))
      void invalidateTargets()
    },
    onError: () => setSeedStatus('Seed failed — check server logs')
  })

  const deleteMutation = useMutation({
    mutationFn: async (row: MergedRow) => {
      // AUTH-CRITICAL read-only gate; the server also enforces requireTargetTokenWriter on DELETE.
      if (!canEdit || !row.target) return
      const params = new URLSearchParams({
        // DELETE matches the stored PK (row.target.boss_name).
        boss_name: row.target.boss_name,
        rarity: row.rarity,
        set: String(row.set),
        encounter_id: String(row.encounter_id),
        season: selectedSeason
      })
      const response = await fetch(
        `/api/boss-assignments/target-tokens?${params.toString()}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    },
    onSuccess: invalidateTargets
  })

  const startEdit = (row: MergedRow) => {
    // AUTH-CRITICAL read-only gate: members never enter edit mode.
    if (!canEdit) return
    setEditingKey(targetRowKey(row))
    setEditValue(row.target ? String(row.target.target_tokens) : '')
  }

  const cancelEdit = () => setEditingKey(null)

  const saveEdit = (row: MergedRow) => {
    // AUTH-CRITICAL read-only gate: members never upsert a target.
    if (!canEdit) return
    const value = Number.parseFloat(editValue)
    if (!Number.isFinite(value) || value <= 0) {
      cancelEdit()
      return
    }
    // Keyed by raw bossType; saving a real value always clears skip.
    upsertMutation.mutate({
      boss_name: row.boss_type,
      rarity: row.rarity,
      set: row.set,
      encounter_id: row.encounter_id,
      target_tokens: value,
      skip: false
    })
  }

  const toggleSkip = (row: MergedRow) => {
    // AUTH-CRITICAL read-only gate: members never toggle a prime skip. Mains are never skipped.
    if (!canEdit || row.encounter_id === 0) return
    const { isSkipped } = deriveSeedState(row.target)
    const currentTokens = row.target?.target_tokens ?? 0
    // "None Available" rows carry a skip=true seed sentinel but show unset, so key off isSkipped.
    if (isSkipped && currentTokens <= 1) {
      // Un-skip. A placeholder (tokens=1) means it was skipped from Unset, so prompt for a target.
      setEditingKey(targetRowKey(row))
      setEditValue('')
      return
    }
    // Skip writes tokens=1 for Unset or the None-Available sentinel, else keeps tokens; always
    // skip=true. target_tokens > 0 is a DB CHECK: never write 0.
    upsertMutation.mutate({
      boss_name: row.boss_type,
      rarity: row.rarity,
      set: row.set,
      encounter_id: row.encounter_id,
      target_tokens: currentTokens > 0 ? currentTokens : 1,
      skip: !isSkipped
    })
  }

  return {
    editingKey,
    editValue,
    setEditValue,
    seedStatus,
    saveError,
    startEdit,
    cancelEdit,
    saveEdit,
    toggleSkip,
    resetTarget: (row: MergedRow) => deleteMutation.mutate(row),
    seedFromHistory: () => seedMutation.mutate(),
    isSaving: upsertMutation.isPending,
    isResetting: deleteMutation.isPending,
    isSeeding: seedMutation.isPending
  }
}
