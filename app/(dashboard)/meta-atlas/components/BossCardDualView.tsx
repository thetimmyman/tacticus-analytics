'use client'

import { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { BossPortrait } from '@/app/components/ui/BossPortrait'

type BossCardDualViewProps = {
  bossName: string
  bossType: string
  bossLookupName?: string
  raritySet: string
  summary?: string | null
  viewMode: 'global' | 'personal'
  onViewModeChange: (mode: 'global' | 'personal') => void
  canPersonalize: boolean
  showViewToggle?: boolean
  globalContent: ReactNode
  personalContent: ReactNode
  badgeClassName: string
  anchorId: string
}

export function BossCardDualView({
  bossName,
  bossType,
  bossLookupName,
  raritySet,
  summary,
  viewMode,
  onViewModeChange,
  canPersonalize,
  showViewToggle = true,
  globalContent,
  personalContent,
  badgeClassName,
  anchorId
}: BossCardDualViewProps) {
  const isPersonal = viewMode === 'personal'
  const disabledMessage = canPersonalize
    ? undefined
    : 'Connect your roster to unlock'
  const content = isPersonal ? personalContent : globalContent

  return (
    <Card
      id={anchorId}
      data-boss-type={bossType}
      className="bg-(--card-bg) border-(--card-border) overflow-hidden"
    >
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BossPortrait
              bossName={bossName}
              lookupName={bossLookupName || bossType}
              size="small"
              variant="icon"
            />
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 text-xs rounded-full border font-medium ${badgeClassName}`}
                >
                  {raritySet}
                </span>
                {bossName}
              </CardTitle>
              {summary && (
                <div className="text-xs text-secondary-wh40k mt-0.5">
                  {summary}
                </div>
              )}
            </div>
          </div>
          {showViewToggle && (
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full border border-(--card-border) bg-card/70 p-1">
                <button
                  type="button"
                  onClick={() => onViewModeChange('global')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    !isPersonal
                      ? 'bg-emerald-500 text-black'
                      : 'text-secondary-wh40k hover:text-white'
                  }`}
                >
                  Global Meta
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (canPersonalize) onViewModeChange('personal')
                  }}
                  disabled={!canPersonalize}
                  title={disabledMessage}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    isPersonal && canPersonalize
                      ? 'bg-emerald-500 text-black'
                      : 'text-secondary-wh40k hover:text-white'
                  } ${canPersonalize ? '' : 'opacity-50 cursor-not-allowed'}`}
                >
                  My Potential
                </button>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-3">{content}</CardContent>
    </Card>
  )
}
