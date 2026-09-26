'use client'

// `MobileSheet` with `desktopBreakpoint="none"`: a bottom sheet on mobile, a dialog on desktop.

import { MobileSheet } from '@/app/components/ui/MobileSheet'
import {
  EncounterOpsPanel,
  type EncounterOpsPanelProps
} from './EncounterOpsPanel'

export interface OpsSurfaceProps extends EncounterOpsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function OpsSurface({ isOpen, onClose, ...panel }: OpsSurfaceProps) {
  return (
    <MobileSheet
      isOpen={isOpen}
      onClose={onClose}
      title={panel.title}
      desktopBreakpoint="none"
    >
      <EncounterOpsPanel {...panel} />
    </MobileSheet>
  )
}
