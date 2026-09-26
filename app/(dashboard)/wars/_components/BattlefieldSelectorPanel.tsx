'use client'

import { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { Sparkles, Info, Swords } from 'lucide-react'
import {
  RadixTabs,
  RadixTabsList,
  RadixTabsTrigger
} from '@tacticus/ui-kit/radix-tabs'
import {
  BATTLEFIELD_LABELS,
  BATTLEFIELD_MULTIPLIERS,
  BattlefieldLevel
} from './zoneManagementShared'

interface BattlefieldSelectorPanelProps {
  battlefieldLevel: BattlefieldLevel
  setBattlefieldLevel: Dispatch<SetStateAction<BattlefieldLevel>>
  userPickedLevelRef: MutableRefObject<boolean>
  recommendedBattlefield: BattlefieldLevel
  averagePlayerLevel: number
}

export default function BattlefieldSelectorPanel({
  battlefieldLevel,
  setBattlefieldLevel,
  userPickedLevelRef,
  recommendedBattlefield,
  averagePlayerLevel
}: BattlefieldSelectorPanelProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--card-border)] bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)]">
      <div className="absolute inset-0 bg-[url('/images/noise.png')] opacity-5 pointer-events-none" />
      <div className="relative p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 border border-red-500/30">
            <Swords className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-[var(--text-primary)] tracking-wide">
              Battlefield Selection
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Choose your combat tier to adjust zone defense requirements
            </p>
          </div>
        </div>

        <RadixTabs
          value={String(battlefieldLevel)}
          onValueChange={(v) => {
            userPickedLevelRef.current = true
            setBattlefieldLevel(Number(v) as BattlefieldLevel)
          }}
        >
          <RadixTabsList className="grid w-full grid-cols-5 gap-1 md:gap-2 h-auto p-1.5 md:p-2 bg-card/30 rounded-lg">
            {([1, 2, 3, 4, 5] as BattlefieldLevel[]).map((level) => {
              const isSelected = level === battlefieldLevel
              const isRecommended = level === recommendedBattlefield
              const difficultyColors = {
                1: {
                  base: 'text-green-300',
                  border: 'border-green-400',
                  glow: 'shadow-[0_0_20px_rgba(74,222,128,0.5)]',
                  bg: 'bg-gradient-to-br from-green-900/80 to-green-950/90'
                },
                2: {
                  base: 'text-blue-300',
                  border: 'border-blue-400',
                  glow: 'shadow-[0_0_20px_rgba(96,165,250,0.5)]',
                  bg: 'bg-gradient-to-br from-blue-900/80 to-blue-950/90'
                },
                3: {
                  base: 'text-purple-300',
                  border: 'border-purple-400',
                  glow: 'shadow-[0_0_20px_rgba(192,132,252,0.5)]',
                  bg: 'bg-gradient-to-br from-purple-900/80 to-purple-950/90'
                },
                4: {
                  base: 'text-orange-300',
                  border: 'border-orange-400',
                  glow: 'shadow-[0_0_20px_rgba(251,146,60,0.5)]',
                  bg: 'bg-gradient-to-br from-orange-900/80 to-orange-950/90'
                },
                5: {
                  base: 'text-red-300',
                  border: 'border-red-400',
                  glow: 'shadow-[0_0_20px_rgba(248,113,113,0.5)]',
                  bg: 'bg-gradient-to-br from-red-900/80 to-red-950/90'
                }
              }
              const colors = difficultyColors[level]

              return (
                <RadixTabsTrigger
                  key={level}
                  value={String(level)}
                  title={BATTLEFIELD_LABELS[level]}
                  className={`
                      relative px-1.5 md:px-4 py-2 md:py-3 text-xs md:text-sm font-bold min-h-[2.5rem] md:min-h-[3rem] overflow-hidden transition-all duration-300
                      rounded-lg border-2
                      ${colors.base}
                      ${
                        isSelected
                          ? `${colors.bg} ${colors.border} ${colors.glow} md:scale-105`
                          : 'bg-card/20 border-card-border/10 hover:border-card-border/30 hover:bg-card/30'
                      }
                    `}
                >
                  <div className="relative z-10 flex flex-col items-center gap-0">
                    <span className="font-black tracking-wider md:tracking-widest text-sm md:text-base">
                      BF{level}
                    </span>
                    <span className="text-[8px] md:text-[10px] opacity-70 font-normal hidden sm:block">
                      {level === 1
                        ? 'Recruit'
                        : level === 2
                          ? 'Veteran'
                          : level === 3
                            ? 'Elite'
                            : level === 4
                              ? 'Champion'
                              : 'Hero'}
                    </span>
                  </div>
                  {isRecommended && (
                    <div className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-green-500 text-[8px] font-bold text-white rounded-bl-md rounded-tr-md shadow-lg">
                      REC
                    </div>
                  )}
                </RadixTabsTrigger>
              )
            })}
          </RadixTabsList>
        </RadixTabs>

        <div className="mt-3 md:mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] md:text-xs">
            <Info className="h-3 w-3 md:h-4 md:w-4 text-[var(--text-secondary)] shrink-0" />
            <span className="text-[var(--text-secondary)]">
              {BATTLEFIELD_MULTIPLIERS[battlefieldLevel]}x multiplier
            </span>
          </div>
          {averagePlayerLevel > 0 && (
            <div className="flex items-center gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded-full bg-green-500/10 border border-green-500/30 self-start sm:self-auto">
              <Sparkles className="h-3 w-3 text-green-400" />
              <span className="text-[10px] md:text-xs text-green-400 font-medium">
                Avg Level: {averagePlayerLevel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
