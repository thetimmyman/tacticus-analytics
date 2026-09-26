'use client'

import Link from 'next/link'
import { ChevronRight, Clock, Ban, Users } from 'lucide-react'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import type { Boss } from '../types'

const BANNED_FACTION_DISPLAY: Record<string, string> = {
  ThousandSons: 'Thousand Sons',
  DeathGuard: 'Death Guard',
  Necrons: 'Necrons',
  Orks: 'Orks',
  Aeldari: 'Aeldari',
  AdeptusMechanicus: 'Adeptus Mechanicus',
  Tau: "T'au Empire",
  AstraMilitarum: 'Astra Militarum',
  Tyranids: 'Tyranids',
  ImperialFists: 'Imperial Fists'
}

interface BossCardProps {
  boss: Boss
  milestone?: string
}

export function BossCard({ boss, milestone }: BossCardProps) {
  const bannedDisplay =
    BANNED_FACTION_DISPLAY[boss.bannedFaction] || boss.bannedFaction
  const isMythic = milestone?.startsWith('M')

  return (
    <Link href={`/boss-playbooks/${boss.id}`}>
      <div className="group card-wh40k p-3 hover:border-[var(--accent)] transition-colors cursor-pointer h-full">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <BossPortrait
              bossName={boss.name}
              lookupName={boss.id}
              size="medium"
              variant="portrait"
            />
            {milestone && (
              <span
                className={`absolute -top-1 -right-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  isMythic
                    ? 'bg-purple-500/90 text-white'
                    : 'bg-amber-500/90 text-white'
                }`}
              >
                {milestone}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--text-primary)] truncate leading-tight">
                  {boss.name}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] truncate">
                  {boss.faction}
                  {boss.strain && (
                    <span className="text-[var(--text-tertiary)]">
                      {' '}
                      • {boss.strain}
                    </span>
                  )}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors shrink-0" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                <Clock className="h-3 w-3" />
                {boss.turnLimit}
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                <Ban className="h-3 w-3" />
                {bannedDisplay}
              </span>
              {boss.primesPlaybook && (
                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                  <Users className="h-3 w-3" />
                  Primes
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
