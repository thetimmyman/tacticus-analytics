'use client'

// Shares the /boss-playbooks controls and writers so the surfaces cannot drift.
// Every field saves immediately; a deferred save loses edits on navigation.

import { useRef, useState } from 'react'
import {
  BehaviourToggle,
  NotesInput,
  OpsCard,
  RoleListInput,
  ThresholdPicker,
  type OpsRoleEntry,
  type ReusableRole
} from '@/app/components/boss-ops'
import {
  MirrorWriteError,
  saveEncounterBehaviour,
  saveEncounterNotes,
  saveEncounterRoles,
  type EncounterRef
} from '@/app/lib/boss-ops/persist-encounter-ops'
import type { EncounterOpsEntry } from '@/app/lib/boss-ops/encounter-ops-merge'
import type {
  SideBehaviour,
  SaveStatus
} from '@/app/lib/boss-ops/encounter-ops-types'

export interface EncounterOpsPanelProps {
  title: string
  ops: EncounterOpsEntry
  /** Officer/leader of THIS guild; the routes have no app-admin bypass. */
  canManage: boolean
  /** A failed read looks empty ('kill'), so editing would silently un-skip a prime. */
  loadFailed: boolean
  seasonNumber: string
  isCurrentSeason: boolean
  guildCode: string
  /** Lets the skip mirror preserve a real value. */
  currentTargetTokens: number
  reusableRoles: ReusableRole[]
  onSaved: () => void
}

type FieldStatus = { status: SaveStatus; note?: string }

export function EncounterOpsPanel({
  title,
  ops,
  canManage,
  loadFailed,
  seasonNumber,
  isCurrentSeason,
  guildCode,
  currentTargetTokens,
  reusableRoles,
  onSaved
}: EncounterOpsPanelProps) {
  const [roles, setRoles] = useState<OpsRoleEntry[]>(() =>
    ops.roleIds.map((id) => ({
      id,
      label: ops.roleLabels[id] ?? '',
      clientKey: `role-${id}`
    }))
  )
  const [behaviour, setBehaviour] = useState<SideBehaviour>(ops.behaviour)
  const [threshold, setThreshold] = useState<number>(ops.thresholdHpPct ?? 60)
  const [fields, setFields] = useState<Record<string, FieldStatus>>({})
  // One in-flight chain per row: the fields echo the same herald_boss_config row, so
  // concurrent saves could echo stale values.
  const inFlightRow = useRef<Promise<unknown>>(Promise.resolve())
  const lastSaved = useRef<Record<string, string>>({})

  const disabled = !canManage || loadFailed
  const isPrime = ops.encounterId !== 0

  const ref: EncounterRef = {
    guildCode,
    bossType: ops.bossType,
    rarity: ops.rarity,
    set: ops.set,
    encounterId: ops.encounterId,
    seasonNumber,
    isCurrentSeason
  }

  const mark = (field: string, status: FieldStatus) =>
    setFields((prev) => ({ ...prev, [field]: status }))

  const run = async (
    field: string,
    fn: () => Promise<void>,
    dedupeKey?: string
  ) => {
    if (dedupeKey !== undefined && lastSaved.current[field] === dedupeKey)
      return
    mark(field, { status: 'saving' })
    try {
      const chained = inFlightRow.current.then(fn, fn)
      inFlightRow.current = chained
      await chained
      if (dedupeKey !== undefined) lastSaved.current[field] = dedupeKey
      mark(field, { status: 'saved' })
      onSaved()
    } catch (error) {
      // A mirror failure means the authoritative write landed; say which view is stale.
      if (error instanceof MirrorWriteError) {
        mark(field, { status: 'saved', note: error.message })
        onSaved()
        return
      }
      mark(field, {
        status: 'error',
        note: error instanceof Error ? error.message : 'Save failed'
      })
      // MUST rethrow: NotesInput keeps its editor and draft only when onChange rejects.
      throw error
    }
  }

  const statusLine = (field: string) => {
    const f = fields[field]
    if (!f || f.status === 'idle') return null
    const tone =
      f.status === 'error'
        ? 'text-red-400'
        : f.note
          ? 'text-(--warning)'
          : 'text-(--text-tertiary)'
    const label =
      f.status === 'saving'
        ? 'Saving…'
        : f.status === 'error'
          ? (f.note ?? 'Save failed')
          : (f.note ?? 'Saved')
    return <div className={`mt-1 text-[10px] ${tone}`}>{label}</div>
  }

  return (
    <OpsCard
      title={title}
      description={
        loadFailed
          ? undefined
          : isPrime
            ? 'Applies to this prime only.'
            : 'Main encounter — always expected.'
      }
    >
      {loadFailed && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-(--danger-bg) px-3 py-2 text-xs text-(--danger)">
          Ops settings could not be loaded. Editing is disabled so a failed read
          can&apos;t be saved back as a change.
        </div>
      )}

      <div>
        <RoleListInput
          label="Discord ping roles"
          roles={roles}
          reusableRoles={reusableRoles}
          disabled={disabled}
          onRememberRoles={() => {}}
          onChange={(next) => {
            setRoles(next)
            // Require complete snowflakes: the regex also matches a 17-digit prefix of an 18-digit id.
            const complete = next.every((r) => /^\d{17,20}$/.test(r.id.trim()))
            if (!complete) return
            const payload = next.map((r) => ({
              id: r.id.trim(),
              label: r.label
            }))
            void run(
              'roles',
              () => saveEncounterRoles(ref, payload),
              JSON.stringify(payload)
            ).catch(() => {})
          }}
        />
        {/* Roles are keyed (guild_code, boss_id), so they are not season-scoped. */}
        <div className="mt-1 text-[10px] text-(--text-tertiary)">
          Ping roles apply to every season, not just S{seasonNumber}.
        </div>
        {statusLine('roles')}
      </div>

      <div>
        <NotesInput
          label="Ping notes"
          value={ops.notes ?? ''}
          disabled={disabled}
          placeholder="Shown in the Herald Discord post for this encounter."
          onChange={(value) =>
            run('notes', () => saveEncounterNotes(ref, value))
          }
        />
        {statusLine('notes')}
      </div>

      {isPrime && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
            Rule
          </div>
          <BehaviourToggle
            value={behaviour}
            disabled={disabled}
            onChange={(next) => {
              setBehaviour(next)
              // run() records the failure and rethrows for the notes editor; swallow it here.
              void run('behaviour', () =>
                saveEncounterBehaviour(ref, {
                  behaviour: next,
                  thresholdHpPct: threshold,
                  // Compare against the persisted value so kill<->threshold never touches boss_target_tokens.
                  wasSkipped: behaviour === 'skip',
                  currentTargetTokens
                })
              ).catch(() => {})
            }}
          />
          {behaviour === 'threshold' && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
                Threshold — HP remaining
              </div>
              <ThresholdPicker
                value={threshold}
                disabled={disabled}
                onChange={(next) => {
                  setThreshold(next)
                  // The field status carries the error; swallow the rethrow.
                  void run('behaviour', () =>
                    saveEncounterBehaviour(ref, {
                      behaviour: 'threshold',
                      thresholdHpPct: next,
                      // Already on threshold, so skip is not changing.
                      wasSkipped: false,
                      currentTargetTokens
                    })
                  ).catch(() => {})
                }}
              />
            </div>
          )}
          {statusLine('behaviour')}
        </div>
      )}

      {!canManage && (
        <div className="text-[10px] text-(--text-tertiary)">
          Ops settings are read-only — officers and leaders of this guild can
          edit them.
        </div>
      )}
    </OpsCard>
  )
}
