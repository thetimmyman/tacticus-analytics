'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { Map } from 'lucide-react'

// Boards are 2048x2048; next/image serves a variant sized to the cell.
const BOARD_IMAGE_SIZE = 2048

// Mirrors the grid: 3 columns at lg, 2 at md, 1 below.
const BOARD_IMAGE_SIZES =
  '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw'

type MapsBoardsSectionProps = {
  bossId: string
}

type BoardEntry = {
  board: string
  path?: string | null
  image_url?: string | null
}

type BoardSection = {
  key: string
  title: string
  subtitle?: string | null
  boards: BoardEntry[]
}

// Title-Case gallery labels; not the "Map 02" badge formatter in seasonal-hub-utils.
const formatBoardLabel = (board: string) => {
  const trimmed = board.trim()
  if (!trimmed) return 'Board'
  const withoutPrefix = trimmed.replace(/^GB_/, '')
  const withSpaces = withoutPrefix
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  if (!withSpaces) return trimmed
  if (/^\d+$/.test(withSpaces)) return `Board ${withSpaces}`
  // "Belisarius support 01" → "Belisarius Support 01".
  return withSpaces.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function BoardCard({ entry }: { entry: BoardEntry }) {
  const label = formatBoardLabel(entry.board)
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] overflow-hidden">
      {entry.image_url ? (
        <Image
          src={entry.image_url}
          alt={`${label} map`}
          width={BOARD_IMAGE_SIZE}
          height={BOARD_IMAGE_SIZE}
          sizes={BOARD_IMAGE_SIZES}
          className="w-full h-auto"
        />
      ) : (
        <div className="aspect-video bg-[color-mix(in_srgb,var(--bg-tertiary)_60%,transparent)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">
          Map image placeholder
        </div>
      )}
      <div className="p-3 space-y-1">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {label}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)]">
          {entry.board}
        </div>
      </div>
    </div>
  )
}

export function MapsBoardsSection({ bossId }: MapsBoardsSectionProps) {
  const [sections, setSections] = useState<BoardSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBoards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/playbooks/${bossId}/maps`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, 'Failed to load maps'))
      }
      const nextSections = (payload?.sections as BoardSection[]) || []
      setSections(nextSections.filter((section) => section.boards?.length > 0))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load maps')
    } finally {
      setLoading(false)
    }
  }, [bossId])

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  const hasBoards = sections.length > 0

  return (
    <div className="card-wh40k p-4 space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Map className="h-4 w-4 text-[var(--accent)]" />
        Maps / Boards
      </div>

      {loading && (
        <div className="text-xs text-[var(--text-tertiary)]">
          Loading maps...
        </div>
      )}
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {!loading && !error && !hasBoards && (
        <div className="text-xs text-[var(--text-tertiary)]">
          No maps available yet.
        </div>
      )}

      {hasBoards && (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.key} className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--card-border)] pb-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {section.title}
                </span>
                {section.subtitle && (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {section.subtitle}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                  {section.boards.length}{' '}
                  {section.boards.length === 1 ? 'board' : 'boards'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {section.boards.map((entry) => (
                  <BoardCard key={entry.board} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
