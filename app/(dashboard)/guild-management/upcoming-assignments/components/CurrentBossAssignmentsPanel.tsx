'use client'

import { useState } from 'react'
import { ClientDate } from '@tacticus/ui-kit'
import { formatNumber } from '@tacticus/app-core/formatters'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import { AssignedAttackersTable } from './AssignedAttackersTable'

export type CurrentBossAssignmentRow = {
  playerId: string
  displayName: string
  tokensAvailable: number | null
  timeToNextToken: string | null
  target: string
  targetId: string
  targetRemainingHp: number | null
  planned: number
  used: number
  remaining: number
  avgDamage: number | null
  actualDamage: number
  estHpRemaining: number | null
  unplanned: boolean
  /** Original target when the cascade moved a mostly-overkill token to a later stage. */
  cascadedFromTarget?: string
}

export function CurrentBossAssignmentsPanel(props: {
  stageCode: string
  loopIndex: number
  remainingHp: number | null
  maxHp: number | null
  rows: CurrentBossAssignmentRow[]
  snapshotAt: string | null
  bossName?: string | null
  avatarMap?: Map<string, string | null>
  guildCode?: string
}) {
  const plannedTokens = props.rows.reduce((sum, row) => sum + row.planned, 0)
  const usedTokens = props.rows.reduce((sum, row) => sum + row.used, 0)
  const actualDamageTotal = props.rows.reduce(
    (sum, row) => sum + row.actualDamage,
    0
  )
  const unplannedCount = props.rows.filter((row) => row.unplanned).length

  // Expanded by default: the headline content on /current.
  const [isExpanded, setIsExpanded] = useState(true)
  const avatarMap = props.avatarMap ?? new Map<string, string | null>()

  const hpLabel =
    typeof props.remainingHp === 'number' &&
    typeof props.maxHp === 'number' &&
    props.maxHp > 0
      ? `${formatNumber(props.remainingHp)} / ${formatNumber(props.maxHp)} HP`
      : null

  return (
    <div className="rounded-lg border border-(--card-border) bg-card/40 p-4">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
      >
        <div className="flex items-start gap-3">
          <span className="mt-1 text-secondary-wh40k">
            {isExpanded ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </span>
          {props.bossName && (
            <div className="mt-0.5 shrink-0">
              <BossPortrait
                bossName={props.bossName}
                size="small"
                variant="icon"
              />
            </div>
          )}
          <div>
            {/* Boss name first; tier and loop as compact badges. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-primary-wh40k">
                {props.bossName
                  ? getBossDisplayName(props.bossName)
                  : 'Current assignment'}
              </span>
              <span className="inline-flex items-center rounded-sm bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] text-(--primary) px-1.5 py-0.5 text-[11px] font-bold">
                {props.stageCode}
              </span>
              <span className="text-[11px] text-secondary-wh40k">
                Loop {props.loopIndex}
              </span>
            </div>
            <div className="mt-1 text-xs text-secondary-wh40k">
              <span className="mr-3">
                <span className="text-primary-wh40k font-medium">
                  {formatNumber(usedTokens)}
                </span>
                <span className="opacity-75">
                  {' '}
                  / {formatNumber(plannedTokens)} tokens used
                </span>
              </span>
              <span className="mr-3">
                <span className="text-primary-wh40k font-medium">
                  {formatNumber(actualDamageTotal)}
                </span>
                <span className="opacity-75"> dmg</span>
              </span>
              {hpLabel && <span className="opacity-75">{hpLabel}</span>}
            </div>
            {unplannedCount > 0 && (
              <div className="mt-2 text-xs text-amber-300">
                Detected {unplannedCount} unplanned attacker
                {unplannedCount === 1 ? '' : 's'}; adjusting assignments to
                match.
              </div>
            )}
          </div>
        </div>
        {props.snapshotAt && (
          <div className="text-xs text-secondary-wh40k">
            Updated <ClientDate date={props.snapshotAt} format="time" />
          </div>
        )}
      </button>

      {isExpanded && (
        <div className="mt-3">
          <AssignedAttackersTable
            rows={props.rows}
            avatarMap={avatarMap}
            guildCode={props.guildCode}
            emptyMessage="No assignments for this boss yet."
          />
        </div>
      )}
    </div>
  )
}
