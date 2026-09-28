'use client'

import Link from 'next/link'
import { useDataContext } from '@/app/lib/hooks/useDataContext'

interface MetaScopeLinksProps {
  hasCluster: boolean
}

// Labelled "Global Meta" because it is; `hasCluster` is an access gate, not a scope claim.
export function MetaScopeLinks({ hasCluster }: MetaScopeLinksProps) {
  if (!hasCluster) return null

  return (
    <p className="mt-1.5 text-xs text-secondary-wh40k">
      Related:{' '}
      <Link
        href="/leaderboards/meta-analysis"
        className="text-(--accent) underline-offset-4 hover:underline"
      >
        Global Meta
      </Link>{' '}
      (what every guild actually runs)
    </p>
  )
}

export function ContextualMetaScopeLinks() {
  const { context } = useDataContext()

  return <MetaScopeLinks hasCluster={Boolean(context.clusterCode)} />
}
