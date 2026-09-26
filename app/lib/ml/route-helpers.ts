import { requireSessionUser } from '@/app/lib/api/session-user'
import { db, type Database } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import { requireMlScope } from './require-ml-scope'

interface MlRpcError {
  code?: string
  message: string
}

type MlRpcResult = {
  data: unknown[] | null
  error: MlRpcError | null
}

type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<MlRpcResult>

export async function authorizeMlRouteScope(
  guildCode: string | undefined,
  clusterCode: string | null
): Promise<{ guildCode: string; supabase: Database }> {
  if (!guildCode) {
    throw Errors.validation('guild query parameter is required')
  }

  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Authentication required')
  )
  await requireMlScope(supabase, user.id, guildCode, clusterCode)
  return { guildCode, supabase }
}

export function callUntypedMlRpc(
  supabase: Database,
  fn: string,
  args: Record<string, unknown>
): Promise<MlRpcResult> {
  const rpc = (
    supabase.rpc as unknown as (...rpcArgs: unknown[]) => unknown
  ).bind(supabase) as unknown as UntypedRpc
  return rpc(fn, args)
}
