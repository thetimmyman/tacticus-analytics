'use client'

import Image from 'next/image'
import {
  RadixTooltip,
  RadixTooltipTrigger,
  RadixTooltipContent
} from '@tacticus/ui-kit/radix-tooltip'
import { getZoneImageUrl } from '../_utils/zone-images'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

type ZoneImageTooltipProps = {
  zoneType: string | null | undefined
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export default function ZoneImageTooltip({
  zoneType,
  children,
  side = 'top'
}: ZoneImageTooltipProps) {
  // The image is keyed by the RAW zone type; only caption and alt text are formatted.
  const imageUrl = getZoneImageUrl(zoneType)
  const displayName = zoneDisplayName(zoneType)

  if (!imageUrl) {
    return <>{children}</>
  }

  return (
    <RadixTooltip delayDuration={200}>
      <RadixTooltipTrigger asChild>
        <div className="inline-block cursor-help">{children}</div>
      </RadixTooltipTrigger>
      <RadixTooltipContent side={side} className="p-1">
        <div className="flex flex-col items-center gap-1">
          <Image
            src={imageUrl}
            alt={`${displayName} battlefield ground texture`}
            width={160}
            height={160}
            className="rounded-sm border border-(--border) object-cover"
            unoptimized
          />
          <span className="text-xs text-secondary-wh40k">{displayName}</span>
        </div>
      </RadixTooltipContent>
    </RadixTooltip>
  )
}
