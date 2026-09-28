'use client'

import { useState, useEffect } from 'react'
import { Button } from '@tacticus/ui-kit'
import { formatNumber } from '@tacticus/app-core/formatters'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import type { RosterUnit } from '../types'
import type { BaseModalProps } from './types'

type RosterViewerModalProps = Omit<BaseModalProps, 'onMemberUpdate'>

const RANK_NAMES: Record<number, string> = {
  1: 'Stone I',
  2: 'Stone II',
  3: 'Stone III',
  4: 'Iron I',
  5: 'Iron II',
  6: 'Iron III',
  7: 'Bronze I',
  8: 'Bronze II',
  9: 'Bronze III',
  10: 'Silver I',
  11: 'Silver II',
  12: 'Silver III',
  13: 'Gold I',
  14: 'Gold II',
  15: 'Gold III',
  16: 'Diamond I',
  17: 'Diamond II',
  18: 'Diamond III'
}

function getRankName(rank: number): string {
  return RANK_NAMES[rank] || `Rank ${rank}`
}

function getRankColor(rank: number): string {
  if (rank >= 16) return 'text-cyan-300'
  if (rank >= 13) return 'text-yellow-400'
  if (rank >= 10) return 'text-gray-300'
  if (rank >= 7) return 'text-orange-400'
  if (rank >= 4) return 'text-gray-400'
  return 'text-stone-500'
}

export function RosterViewerModal({ member, onClose }: RosterViewerModalProps) {
  const [rosterData, setRosterData] = useState<{
    units: RosterUnit[]
    powerLevel?: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchRoster = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/members/roster?player_id=${encodeURIComponent(member.player_id)}`
        )
        const data = await response.json()
        if (!response.ok) {
          const errorMsg =
            typeof data.error === 'object' ? data.error?.message : data.error
          setError(errorMsg || 'Failed to fetch roster')
          return
        }
        setRosterData({ units: data.units || [], powerLevel: data.powerLevel })
      } catch {
        setError('Failed to connect to server')
      } finally {
        setLoading(false)
      }
    }

    fetchRoster()
  }, [member.player_id])

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k mb-4">
        Roster - <MemberName value={member.display_name} />
      </h3>
      {loading && (
        <div className="py-8 text-center">
          <p className="text-secondary-wh40k">Loading roster...</p>
        </div>
      )}
      {error && (
        <div className="py-8 text-center">
          <p className="text-red-400 mb-2">{error}</p>
          {error.includes('API key') && (
            <p className="text-xs text-(--text-tertiary)">
              This player needs to configure their Player API key to view their
              roster.
            </p>
          )}
        </div>
      )}
      {rosterData && (
        <div className="space-y-4">
          {rosterData.powerLevel && (
            <div className="text-sm text-secondary-wh40k">
              Power Level:{' '}
              <span className="text-primary-wh40k font-medium">
                {formatNumber(rosterData.powerLevel)}
              </span>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-(--card-bg)">
                <tr className="border-b border-(--card-border)">
                  <th className="text-left py-2 text-xs text-secondary-wh40k">
                    Character
                  </th>
                  <th className="text-center py-2 text-xs text-secondary-wh40k">
                    Rank
                  </th>
                  <th className="text-center py-2 text-xs text-secondary-wh40k">
                    Level
                  </th>
                  <th className="text-left py-2 text-xs text-secondary-wh40k">
                    Faction
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--card-border)">
                {rosterData.units
                  .sort((a, b) => b.rank - a.rank)
                  .slice(0, 50)
                  .map((unit) => (
                    <tr
                      key={unit.id}
                      className="hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]"
                    >
                      <td className="py-2 text-primary-wh40k">{unit.name}</td>
                      <td
                        className={`py-2 text-center font-medium ${getRankColor(unit.rank)}`}
                      >
                        {getRankName(unit.rank)}
                      </td>
                      <td className="py-2 text-center text-secondary-wh40k">
                        {unit.xpLevel}
                      </td>
                      <td className="py-2 text-secondary-wh40k text-xs">
                        {unit.faction}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {rosterData.units.length > 50 && (
              <p className="text-xs text-(--text-tertiary) text-center mt-2">
                Showing top 50 of {formatNumber(rosterData.units.length)}{' '}
                characters
              </p>
            )}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-3 mt-4">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </ModalShell>
  )
}
