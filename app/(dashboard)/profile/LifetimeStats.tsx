'use client'

import { useEffect, useState } from 'react'
import { formatNumber } from '@/app/lib/utils/number-format'

interface LifetimeStatsData {
  seasonsParticipated: number
  lordsFelled: number
  bestDamage: { damage: number; bossName: string } | null
  submissionCount: number
  guildWarsParticipated: number
}

export function LifetimeStats() {
  const [data, setData] = useState<LifetimeStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/player/lifetime-stats')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {['s1', 's2', 's3', 's4'].map((k) => (
          <div
            key={k}
            className="h-20 rounded-lg bg-(--card-bg) animate-pulse border border-(--card-border)"
          />
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <p className="text-sm text-secondary-wh40k">No recorded activity yet.</p>
    )
  }

  const isEmpty =
    data.seasonsParticipated === 0 &&
    data.lordsFelled === 0 &&
    data.submissionCount === 0 &&
    data.guildWarsParticipated === 0

  if (isEmpty) {
    return (
      <p className="text-sm text-secondary-wh40k">No recorded activity yet.</p>
    )
  }

  const cards = [
    {
      label: 'Seasons',
      value: data.seasonsParticipated.toString(),
      sub: 'participated'
    },
    {
      label: 'Lords Felled',
      value: formatNumber(data.lordsFelled, { style: 'compact', decimals: 1 }),
      sub: 'boss kills'
    },
    {
      label: 'Best Hit',
      value: data.bestDamage
        ? formatNumber(data.bestDamage.damage, {
            style: 'compact',
            decimals: 1
          })
        : '—',
      sub: data.bestDamage?.bossName ?? 'no data'
    },
    {
      label: 'Guild Wars',
      value: data.guildWarsParticipated.toString(),
      sub: `${formatNumber(data.submissionCount, { style: 'compact', decimals: 1 })} submissions`
    }
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="p-4 rounded-lg bg-(--card-bg) border border-(--card-border) text-center"
        >
          <p className="text-2xl font-bold text-primary-wh40k">{card.value}</p>
          <p className="text-xs font-medium text-accent-wh40k mt-1">
            {card.label}
          </p>
          <p className="text-xs text-secondary-wh40k mt-0.5">{card.sub}</p>
        </div>
      ))}
    </div>
  )
}
