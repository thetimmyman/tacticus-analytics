'use client'

import { useMemberLabels } from '@/app/hooks/useMemberLabels'

interface MemberNameProps {
  /** Raw display_name (may carry the `(guildCode_NN)` suffix). */
  value: string | null | undefined
  fallback?: string
}

/** Display-only friendly label; keep the raw `value` for keys, sorts, URLs and lookups. */
export function MemberName({
  value,
  fallback = ''
}: MemberNameProps): React.ReactElement {
  const { labelFor } = useMemberLabels()
  return <>{value ? labelFor(value) : fallback}</>
}
