'use client'

import { useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  SeasonSelectorPills,
  type SeasonOption
} from '@/app/components/ui/SeasonSelectorPills'

export interface AssignmentSeasonWindowProps {
  options: SeasonOption[]
  value: string
}

export function AssignmentSeasonWindow({
  options,
  value
}: AssignmentSeasonWindowProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleChange = useCallback(
    (nextSeason: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('season', nextSeason)
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="flex items-center justify-end">
      <SeasonSelectorPills
        options={options}
        value={value}
        onChange={handleChange}
        ariaLabel="Assignment season"
      />
    </div>
  )
}
