import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult
} from '@tanstack/react-query'

export interface BaseQueryOptions<
  TQueryFnData,
  TData = TQueryFnData
> extends Omit<
  UseQueryOptions<TQueryFnData, Error, TData, QueryKey>,
  'queryKey' | 'queryFn'
> {
  queryKey: QueryKey
  queryFn: () => Promise<TQueryFnData>
  cacheDuration?: number
  retryCount?: number
}

export function useBaseQuery<TQueryFnData, TData = TQueryFnData>(
  options: BaseQueryOptions<TQueryFnData, TData>
): UseQueryResult<TData, Error> {
  const {
    queryKey,
    queryFn,
    cacheDuration = 5 * 60 * 1000,
    retryCount = 3,
    ...rest
  } = options

  return useQuery({
    queryKey,
    queryFn,
    staleTime: cacheDuration,
    gcTime: cacheDuration * 2,
    retry: retryCount,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...rest
  })
}
