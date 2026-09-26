'use client'

import Link from 'next/link'
import { ArrowLeft, Dna, ChevronRight } from 'lucide-react'
import { QuickStatsCard } from '../components/QuickStatsCard'
import { RaidTeamsSection } from '../components/RaidTeamsSection'
import { MinimumRequirementsEditor } from '../components/MinimumRequirementsEditor'
import { MapsBoardsSection } from '../components/MapsBoardsSection'
import type { Boss } from '../types'

interface BossPlaybookDetailProps {
  boss: Boss
  canEdit?: boolean
}

export function BossPlaybookDetail({
  boss,
  canEdit = false
}: BossPlaybookDetailProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/boss-playbooks"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All Playbooks
        </Link>

        <Link
          href="/meta-atlas"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] transition-colors"
        >
          <Dna className="h-4 w-4" />
          <span className="hidden sm:inline">View Teams in</span> Meta Atlas
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <QuickStatsCard boss={boss} />

      <RaidTeamsSection bossId={boss.id} bossName={boss.name} />

      <MinimumRequirementsEditor bossId={boss.id} canEdit={canEdit} />

      <MapsBoardsSection bossId={boss.id} />
    </div>
  )
}
