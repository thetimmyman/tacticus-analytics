import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export interface GlobalWarMetaFilters {
  seasons: number[]
  battlefieldLevels: number[]
}

interface RpcResult<T> {
  data: T | null
  error: { code?: string; message: string } | null
}

export async function callGlobalWarMetaRpc<T>(
  supabase: TypedSupabaseClient,
  functionName: string,
  args?: Record<string, unknown>
): Promise<RpcResult<T>> {
  const rpc = (
    supabase.rpc as unknown as (...rpcArgs: unknown[]) => unknown
  ).bind(supabase) as (
    name: string,
    params?: Record<string, unknown>
  ) => Promise<RpcResult<T>>
  return args ? rpc(functionName, args) : rpc(functionName)
}

export async function loadGlobalWarMetaFilters(
  supabase: TypedSupabaseClient
): Promise<RpcResult<GlobalWarMetaFilters>> {
  return callGlobalWarMetaRpc<GlobalWarMetaFilters>(
    supabase,
    'get_global_war_meta_filters'
  )
}
