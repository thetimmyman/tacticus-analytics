'use client'

import { useSelectedLayoutSegment } from 'next/navigation'
import { WarSubnav } from '@/app/components/navigation/WarSubnav'
import { WAR_GLOBAL_SEGMENTS } from '@/app/components/navigation/config'

// Global /wars routes get pills from SectionSubnav; only per-war detail tabs need WarSubnav.
export function WarSubnavWrapper() {
  const segment = useSelectedLayoutSegment()

  if (!segment || WAR_GLOBAL_SEGMENTS.has(segment)) return null

  return <WarSubnav mode={{ kind: 'detail', warId: segment }} />
}
