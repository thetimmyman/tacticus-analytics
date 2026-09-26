'use client'

import type { Dispatch, SetStateAction } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from '@tacticus/ui-kit/select'
import type { MetaTeamProgression } from '../types'
import {
  resolveMetaTeamAvailabilityBadge,
  resolveMetaTeamBadge,
  resolveMetaTeamKey,
  resolveMetaTeamLabelClass,
  resolveRankBadgeClass
} from './personal-potential-model'

type PersonalPotentialMetaTeamSelectProps = {
  resolvedMetaTeamKey: string | null
  setSelectedMetaTeamKey: Dispatch<SetStateAction<string | null>>
  setHasMetaTeamSelected: Dispatch<SetStateAction<boolean>>
  selectedMetaTeamRank: number | null
  selectedMetaTeam: MetaTeamProgression | null | undefined
  selectedMetaTeamLabel: string
  selectedMetaTeamAvailabilityBadge: { label: string; className: string }
  selectedMetaTeamBadge: { label: string; className: string }
  metaTeamProgressions: MetaTeamProgression[]
  metaTeamRankings: Map<string, number>
}

export function PersonalPotentialMetaTeamSelect({
  resolvedMetaTeamKey,
  setSelectedMetaTeamKey,
  setHasMetaTeamSelected,
  selectedMetaTeamRank,
  selectedMetaTeam,
  selectedMetaTeamLabel,
  selectedMetaTeamAvailabilityBadge,
  selectedMetaTeamBadge,
  metaTeamProgressions,
  metaTeamRankings
}: PersonalPotentialMetaTeamSelectProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
        Meta Team
      </span>
      <Select
        value={resolvedMetaTeamKey ?? resolveMetaTeamKey(null)}
        onValueChange={(value) => {
          setSelectedMetaTeamKey(value)
          setHasMetaTeamSelected(true)
        }}
      >
        <SelectTrigger className="min-w-[220px] px-3 py-2">
          <div className="flex w-full items-center gap-2">
            {selectedMetaTeamRank != null && (
              <span
                className={`order-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${resolveRankBadgeClass(selectedMetaTeamRank)}`}
              >
                Rank #{selectedMetaTeamRank}
              </span>
            )}
            <span
              className={`order-2 inline-flex max-w-[150px] items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:order-4 sm:ml-auto ${resolveMetaTeamLabelClass(selectedMetaTeam?.meta_team ?? null, true)}`}
            >
              {selectedMetaTeamLabel}
            </span>
            <span
              className={`order-3 ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:order-2 sm:ml-0 ${selectedMetaTeamAvailabilityBadge.className}`}
            >
              {selectedMetaTeamAvailabilityBadge.label}
            </span>
            <span
              className={`order-4 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:order-3 ${selectedMetaTeamBadge.className}`}
            >
              {selectedMetaTeamBadge.label}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {metaTeamProgressions.map((entry) => {
            const key = resolveMetaTeamKey(entry.meta_team)
            const badge = resolveMetaTeamBadge(entry.worst_state)
            const availabilityBadge = resolveMetaTeamAvailabilityBadge(
              entry.is_buildable
            )
            const rank = metaTeamRankings.get(key) ?? null
            const rankClass = resolveRankBadgeClass(rank)
            return (
              <SelectItem key={key} value={key}>
                <span className="flex w-full items-center gap-2">
                  {rank != null && (
                    <span
                      className={`order-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${rankClass}`}
                    >
                      Rank #{rank}
                    </span>
                  )}
                  <span
                    className={`order-2 inline-flex max-w-[150px] items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:order-4 sm:ml-auto ${resolveMetaTeamLabelClass(entry.meta_team ?? null, false)}`}
                  >
                    {entry.meta_team ?? 'Custom Team'}
                  </span>
                  <span
                    className={`order-3 ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:order-2 sm:ml-0 ${availabilityBadge.className}`}
                  >
                    {availabilityBadge.label}
                  </span>
                  <span
                    className={`order-4 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:order-3 ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
