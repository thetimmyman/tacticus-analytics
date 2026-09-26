/**
 * One transaction: the RPC resolves players from the erasure ledger (incl. departed)
 * and row-locks the mappings so a concurrent claim's new owner is never tombstoned.
 */

type AnonymizeRpcResult = {
  data: unknown
  error: { message: string } | null
}

type RpcCapable = {
  rpc(
    name: 'anonymize_subject_battle_rows',
    args: { p_user_id: string }
  ): PromiseLike<AnonymizeRpcResult>
}

export async function anonymizeSubjectBattleRows(
  supabase: unknown,
  userId: string
): Promise<number> {
  const client = supabase as RpcCapable
  const { data, error } = await client.rpc('anonymize_subject_battle_rows', {
    p_user_id: userId
  })
  // Fail closed: never silently under-erase.
  if (
    error ||
    typeof data !== 'number' ||
    !Number.isInteger(data) ||
    data < 0
  ) {
    throw new Error(
      `Failed to anonymize battle data: ${error?.message ?? 'invalid response'}`
    )
  }
  return data
}
