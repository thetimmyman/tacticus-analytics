'use client'

import { useQuery } from '@tanstack/react-query'
import type { MetaFilters } from '../types'

async function fetchMetaFilters(): Promise<MetaFilters> {
  const res = await fetch('/api/meta/filters')
  if (!res.ok) throw new Error('Failed to fetch meta filters')
  return res.json()
}

export function useMetaFilters() {
  const { data: filters, isLoading: loading } = useQuery({
    queryKey: ['metaFilters'],
    queryFn: fetchMetaFilters,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  })

  return { filters: filters ?? null, loading }
}
