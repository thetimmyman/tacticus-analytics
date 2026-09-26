import type { AppError } from '@/app/lib/errors/AppError'

/**
 * request.json() that throws the caller's own legacy 400 shape on parse failure.
 * Only for dedicated parse->400 blocks, not whole-handler try wrappers.
 */
export async function parseJsonBody<T = unknown>(
  request: Request,
  makeError: () => AppError
): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw makeError()
  }
}
