'use client'

import { Spinner } from '@tacticus/ui-kit'

import { useState, useEffect } from 'react'
import {
  BookOpen,
  Lock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Ban,
  Globe,
  Table2,
  ClipboardList,
  Map
} from 'lucide-react'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { RaidTeamsSection } from '@/app/(dashboard)/boss-playbooks/components/RaidTeamsSection'
import { MinimumRequirementsEditor } from '@/app/(dashboard)/boss-playbooks/components/MinimumRequirementsEditor'
import { MapsBoardsSection } from '@/app/(dashboard)/boss-playbooks/components/MapsBoardsSection'
import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import { useFeatureStage } from '@/app/lib/hooks/useFeatureStage'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import type { Boss } from '@/app/(dashboard)/boss-playbooks/types'
import { getPlaybookId } from '@/app/lib/boss-playbooks/playbook-id'
import Link from 'next/link'

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

const TACTICUS_TABLE_BASE_URL = 'https://www.tacticustable.com/guild-boss'

interface BossPlaybookSectionProps {
  displayBossName: string
}

interface PlaybookData {
  boss: Boss
  markdownContent: string
  primesMarkdownContent?: string
  lastUpdated: string
}

interface CollapsibleSectionProps {
  title: string
  icon: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

function CollapsibleSection({
  title,
  icon,
  isOpen,
  onToggle,
  children
}: CollapsibleSectionProps) {
  return (
    <div className="border border-(--card-border) rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-(--bg-secondary) transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-primary-wh40k">
            {title}
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-secondary-wh40k" />
        ) : (
          <ChevronDown className="h-4 w-4 text-secondary-wh40k" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-(--card-border)">{children}</div>
      )}
    </div>
  )
}

export function BossPlaybookSection({
  displayBossName
}: BossPlaybookSectionProps) {
  const stage = useFeatureStage('boss_playbooks') || 'beta'
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [playbookData, setPlaybookData] = useState<PlaybookData | null>(null)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const [mapsOpen, setMapsOpen] = useState(false)

  const playbookId = getPlaybookId(displayBossName)

  useEffect(() => {
    if (!isExpanded || !playbookId || playbookData) return

    const fetchPlaybook = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/playbooks/${playbookId}`)
        const data = await response.json()

        if (response.status === 403) {
          setAccessDenied(true)
          return
        }

        if (!response.ok) {
          throw new Error(extractErrorMessage(data, 'Failed to fetch playbook'))
        }

        setPlaybookData({
          boss: data.data.boss,
          markdownContent: data.data.markdownContent,
          primesMarkdownContent: data.data.primesMarkdownContent,
          lastUpdated: data.data.lastUpdated
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load playbook')
      } finally {
        setLoading(false)
      }
    }

    fetchPlaybook()
  }, [isExpanded, playbookId, playbookData])

  if (!playbookId) {
    return null
  }

  const boss = playbookData?.boss
  const bannedDisplay = boss
    ? BANNED_FACTION_DISPLAY[boss.bannedFaction] || boss.bannedFaction
    : ''
  const tacticusTableLinks = boss?.tacticusTableIds
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
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-(--bg-secondary) transition-colors"
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-(--accent)" />
          <span className="font-semibold text-primary-wh40k">
            Boss Playbook
          </span>
          {stage !== 'public' && <ReleaseStageBadge stage={stage} size="sm" />}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-secondary-wh40k" />
        ) : (
          <ChevronDown className="h-5 w-5 text-secondary-wh40k" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-(--card-border)">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          )}

          {accessDenied && (
            <div className="flex flex-col items-center justify-center py-8 gap-4 px-4">
              <Lock className="h-12 w-12 text-(--text-tertiary)" />
              <div className="text-center">
                <h3 className="font-semibold text-primary-wh40k mb-1">
                  Alpha Access Required
                </h3>
                <p className="text-sm text-secondary-wh40k max-w-md">
                  Boss Playbooks are currently in alpha testing. Contact your
                  cluster admin for access.
                </p>
              </div>
            </div>
          )}

          {error && !accessDenied && (
            <div className="text-center py-8 text-secondary-wh40k px-4">
              {error}
            </div>
          )}

          {playbookData && boss && (
            <div className="space-y-4 p-4">
              {/* Boss Header with Portrait and Quick Info */}
              <div className="flex items-start gap-4 pb-4 border-b border-(--card-border)">
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
                      <h3 className="text-lg font-bold text-primary-wh40k leading-tight">
                        {boss.name}
                      </h3>
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

              {/* External Links */}
              {(boss.wikiUrl || tacticusTableLinks.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 px-0 py-2 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] rounded-lg">
                  <span className="text-xs font-medium text-(--text-tertiary) uppercase tracking-wide px-2">
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

              {/* Raid Teams Section - the main content from new playbook page */}
              <RaidTeamsSection bossId={playbookId} bossName={boss.name} />

              {/* Collapsible Sections */}
              <div className="space-y-2">
                <CollapsibleSection
                  title="Minimum Viable Team Requirements"
                  icon={<ClipboardList className="h-4 w-4 text-(--accent)" />}
                  isOpen={requirementsOpen}
                  onToggle={() => setRequirementsOpen(!requirementsOpen)}
                >
                  <MinimumRequirementsEditor
                    bossId={playbookId}
                    canEdit={false}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  title="Maps / Boards"
                  icon={<Map className="h-4 w-4 text-(--accent)" />}
                  isOpen={mapsOpen}
                  onToggle={() => setMapsOpen(!mapsOpen)}
                >
                  <MapsBoardsSection bossId={playbookId} />
                </CollapsibleSection>
              </div>

              {/* Footer with link to full playbook */}
              <div className="flex items-center justify-between pt-2 border-t border-(--card-border)">
                <span className="text-xs text-(--text-tertiary)">
                  Updated: {playbookData.lastUpdated}
                </span>
                <Link
                  href={`/boss-playbooks/${playbookId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-(--accent) hover:underline"
                >
                  Full Playbook
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
