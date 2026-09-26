export const isMissingRpc = (msg: string): boolean =>
  msg.includes('does not exist') ||
  msg.includes('not found') ||
  msg.includes('schema cache') ||
  msg.includes('column ps.')

export const describeSupabaseError = (error: unknown): string => {
  if (!error) {
    return 'Unknown Supabase error'
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (typeof error === 'object') {
    const candidate =
      (error as Record<string, unknown>).message ??
      (error as Record<string, unknown>).details ??
      (error as Record<string, unknown>).hint ??
      (error as Record<string, unknown>).code

    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }

    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}
