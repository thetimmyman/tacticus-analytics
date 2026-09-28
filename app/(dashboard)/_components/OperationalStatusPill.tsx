'use client'

import {
  RadixTooltip,
  RadixTooltipTrigger,
  RadixTooltipContent
} from '@tacticus/ui-kit/radix-tooltip'
import { CORNER_STACK_PILL_SLOT_CLASS } from '@/app/components/ui/corner-stack'
import {
  useOperationalStatus,
  OPERATIONAL_STATE_STYLES
} from './useOperationalStatus'
import { useCornerDock } from '@/app/providers/CornerDockContext'

// Fallback pill for users without Tech Priest access; the dock shows this status otherwise.
export default function OperationalStatusPill() {
  const data = useOperationalStatus()
  const { dockActive } = useCornerDock()

  if (!data || dockActive) return null

  const styles = OPERATIONAL_STATE_STYLES[data.state]

  return (
    <RadixTooltip delayDuration={150}>
      <RadixTooltipTrigger asChild>
        {/* Stacked above the SYS chip — geometry owned by corner-stack.ts. */}
        <button
          type="button"
          aria-label={`System status: ${styles.label}`}
          className={`${CORNER_STACK_PILL_SLOT_CLASS} inline-flex items-center gap-2 rounded-full border border-(--border) bg-[color-mix(in_srgb,var(--card-bg)_95%,transparent)] px-3 py-1.5 text-xs font-medium text-secondary-wh40k shadow-md backdrop-blur-xs ring-1 ${styles.ring} hover:bg-(--card-bg) focus:outline-hidden focus:ring-2 focus:ring-offset-1 focus:ring-offset-(--bg-primary)`}
        >
          <span
            className={`h-2 w-2 rounded-full ${styles.dot} animate-pulse`}
            aria-hidden="true"
          />
          <span>{styles.label}</span>
        </button>
      </RadixTooltipTrigger>
      <RadixTooltipContent side="top" align="end" className="max-w-xs">
        <div className="text-xs leading-relaxed">{data.summary}</div>
      </RadixTooltipContent>
    </RadixTooltip>
  )
}
