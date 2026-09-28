'use client'

import { Ban, ExternalLink, Globe, Table2 } from 'lucide-react'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import type { Boss } from '../types'

const TACTICUS_TABLE_BASE_URL = 'https://www.tacticustable.com/guild-boss'

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

interface QuickStatsCardProps {
  boss: Boss
}

export function QuickStatsCard({ boss }: QuickStatsCardProps) {
  const bannedDisplay =
    BANNED_FACTION_DISPLAY[boss.bannedFaction] || boss.bannedFaction

  const tacticusTableLinks = boss.tacticusTableIds
    ? [
        { label: 'Tacticus Table Main Boss', id: boss.tacticusTableIds.boss },
        ...(boss.tacticusTableIds.prime1
          ? [
              {
                label: 'Tacticus Table Prime 1',
                id: boss.tacticusTableIds.prime1
              }
            ]
          : []),
        ...(boss.tacticusTableIds.prime2
          ? [
              {
                label: 'Tacticus Table Prime 2',
                id: boss.tacticusTableIds.prime2
              }
            ]
          : [])
      ]
    : []

  return (
    <div className="card-wh40k overflow-hidden">
      <div className="flex items-start gap-4 p-4 border-b border-(--card-border)">
        <BossPortrait
          bossName={boss.name}
          lookupName={boss.id}
          size="header"
          variant="portrait"
          className="shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-primary-wh40k leading-tight">
                {boss.name}
              </h2>
              <p className="text-sm text-secondary-wh40k">
                {boss.faction}
                {boss.strain && (
                  <span className="text-(--text-tertiary)">
                    {' '}
                    • {boss.strain}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-red-500/15 text-red-400 border border-red-500/25">
              <Ban className="h-3 w-3" />
              {bannedDisplay} banned
            </span>
          </div>
        </div>
      </div>

      {(boss.wikiUrl || tacticusTableLinks.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-(--bg-secondary)">
          <span className="text-xs font-medium text-(--text-tertiary) uppercase tracking-wide">
            External:
          </span>
          {boss.wikiUrl && (
            <a
              href={boss.wikiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-(--bg-primary) text-(--accent) border border-(--card-border) hover:border-accent-wh40k hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-colors font-medium"
            >
              <Globe className="h-3.5 w-3.5" />
              Tacticus Wiki
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          )}
          {tacticusTableLinks.map((link) => (
            <a
              key={link.id}
              href={`${TACTICUS_TABLE_BASE_URL}/${link.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-(--bg-primary) text-blue-400 border border-(--card-border) hover:border-blue-400 hover:bg-blue-400/10 transition-colors font-medium"
            >
              <Table2 className="h-3.5 w-3.5" />
              {link.label}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
