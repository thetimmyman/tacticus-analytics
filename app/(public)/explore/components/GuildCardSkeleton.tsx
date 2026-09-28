'use client'

export const SKELETON_CARD_COUNT = 12

export function GuildCardSkeleton() {
  return (
    <div className="rounded-lg border border-(--card-border) bg-card/60 shadow-xs min-h-[182px] overflow-hidden">
      <div className="p-4 sm:p-5 space-y-4 animate-pulse">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-white/5" />
            <div className="space-y-2">
              <div className="h-4 w-32 rounded-sm bg-white/10" />
              <div className="h-3 w-20 rounded-sm bg-white/5" />
            </div>
          </div>
          <div className="hidden sm:grid grid-cols-3 gap-3 w-full max-w-xs">
            <div className="h-4 rounded-sm bg-white/5" />
            <div className="h-4 rounded-sm bg-white/5" />
            <div className="h-4 rounded-sm bg-white/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="h-16 rounded-lg bg-white/5" />
          <div className="h-16 rounded-lg bg-white/5" />
          <div className="h-16 rounded-lg bg-white/5 hidden sm:block" />
        </div>
        <div className="h-6 w-28 rounded-sm bg-white/5" />
      </div>
    </div>
  )
}
