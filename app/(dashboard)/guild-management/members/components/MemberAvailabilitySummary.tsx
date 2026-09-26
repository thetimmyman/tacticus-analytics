'use client'

import type { TokenUsageData, ExtendedMember } from './types'
import { TOKEN_CAP } from './types'
import { getTokenUsageSummary, getBombStatus } from './utils'

interface MemberAvailabilitySummaryProps {
  members: ExtendedMember[]
  tokenData: Record<string, TokenUsageData>
  selectedSeason: string
  tokenDataError?: string | null
  onRetryTokenData?: () => void
}

export function MemberAvailabilitySummary({
  members,
  tokenData,
  selectedSeason,
  tokenDataError = null,
  onRetryTokenData
}: MemberAvailabilitySummaryProps) {
  if (!selectedSeason) return null

  const totals = members.reduce(
    (acc, member) => {
      const usage = getTokenUsageSummary(member, tokenData)
      if (usage) {
        acc.tokensAvailable += usage.available ?? 0
        acc.tokensMax += usage.max ?? TOKEN_CAP
      }
      const bombStatus = getBombStatus(member, tokenData)
      if (bombStatus) {
        acc.bombsAvailable += bombStatus.available ? 1 : 0
        acc.bombsTotal += 1
      }
      return acc
    },
    { tokensAvailable: 0, tokensMax: 0, bombsAvailable: 0, bombsTotal: 0 }
  )

  const tokensSummary =
    totals.tokensMax > 0
      ? `${totals.tokensAvailable} / ${totals.tokensMax}`
      : '—'
  const bombsSummary =
    totals.bombsTotal > 0
      ? `${totals.bombsAvailable} / ${totals.bombsTotal}`
      : '—'

  return (
    <div className="px-6 pb-4">
      {tokenDataError && (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          <span>
            Token availability is temporarily unavailable. Existing member data
            is still shown.
          </span>
          {onRetryTokenData && (
            <button
              type="button"
              onClick={onRetryTokenData}
              className="rounded border border-amber-400/40 px-2 py-1 font-medium text-amber-50 hover:bg-amber-400/10"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
        <span>
          Tokens Available (Player API):{' '}
          <span className="font-mono text-[var(--text-primary)]">
            {tokensSummary}
          </span>
        </span>
        <span>
          Bombs Ready (Player API):{' '}
          <span className="font-mono text-[var(--text-primary)]">
            {bombsSummary}
          </span>
        </span>
      </div>
    </div>
  )
}
