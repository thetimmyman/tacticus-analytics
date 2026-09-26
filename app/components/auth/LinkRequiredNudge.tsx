'use client'

import { useEffect } from 'react'

interface LinkRequiredNudgeProps {
  active: boolean
  targetId?: string
}

export default function LinkRequiredNudge({
  active,
  targetId = 'connected-accounts'
}: LinkRequiredNudgeProps) {
  useEffect(() => {
    if (!active) return
    const el = document.getElementById(targetId)
    if (!el) return

    el.scrollIntoView({ behavior: 'smooth', block: 'start' })

    el.classList.add(
      'ring-2',
      'ring-red-500',
      'ring-offset-2',
      'ring-offset-[var(--bg-primary)]'
    )
    const timer = setTimeout(() => {
      el.classList.remove(
        'ring-2',
        'ring-red-500',
        'ring-offset-2',
        'ring-offset-[var(--bg-primary)]'
      )
    }, 1800)

    return () => clearTimeout(timer)
  }, [active, targetId])

  return null
}
