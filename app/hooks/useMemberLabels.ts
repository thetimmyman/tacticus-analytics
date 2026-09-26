'use client'

import { useCallback, useContext, useMemo } from 'react'
import {
  QueryClient,
  QueryClientContext,
  useQuery
} from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import {
  buildMemberLabelMap,
  resolveMemberLabel,
  type DuplicateDisplayLabel,
  type MemberLabelMap
} from '@/app/lib/member-labels'

// For renders outside a QueryClientProvider (isolated tests); created lazily.
let fallbackQueryClient: QueryClient | undefined
function getFallbackQueryClient(): QueryClient {
  if (!fallbackQueryClient) {
    fallbackQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } }
    })
  }
  return fallbackQueryClient
}

/**
 * Swaps duplicate-name `(<guildCode>_<NN>)` suffixes for `(<previous name>)`.
 * Display only: keep raw display_name for keys, sorting and data lookups.
 */
export function useMemberLabels(): {
  labelMap: MemberLabelMap
  labelFor: (displayName: string | null | undefined) => string
  isLoading: boolean
} {
  const supabase = useMemo(() => dbClient(), [])

  // useQueryClient() throws without a provider; fall back to a private client
  // with the fetch disabled so callers get raw names.
  const contextClient = useContext(QueryClientContext)
  const queryClient = contextClient ?? getFallbackQueryClient()

  const { data: labelMap = new Map() as MemberLabelMap, isLoading } = useQuery(
    {
      queryKey: ['memberLabels', 'duplicateDisplayLabels'],
      queryFn: async (): Promise<MemberLabelMap> => {
        const { data, error } = await supabase.rpc(
          'get_duplicate_display_labels',
          {}
        )
        if (error) throw error
        return buildMemberLabelMap(data as DuplicateDisplayLabel[] | null)
      },
      enabled: contextClient != null,
      staleTime: 30 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      // A failed fetch must never blank names; degrade to raw values.
      retry: 1
    },
    queryClient
  )

  const labelFor = useCallback(
    (displayName: string | null | undefined) =>
      resolveMemberLabel(displayName, labelMap),
    [labelMap]
  )

  return { labelMap, labelFor, isLoading }
}
