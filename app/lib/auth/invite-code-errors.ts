import type { Json } from '@tacticus/app-core/types'
import { Errors } from '@/app/lib/errors/AppError'

type RpcError = { code?: string | null; message?: string | null }

type InviteBusinessFailure = {
  success?: boolean | null
  error?: string | null
  error_code?: string | null
}

/** Surfaces expected business denials but keeps SQL/authorization details out of responses. */
export function throwInviteRpcFailure(
  data: Json,
  error: RpcError | null,
  fallback: string
): never {
  if (error?.code === '42501') {
    throw Errors.fromResponse(403, {
      error: 'You are not authorized to manage these invite codes'
    })
  }
  if (error?.code === '22023') {
    throw Errors.fromResponse(400, { error: 'Invalid invite-code request' })
  }
  if (error?.code === '40001') {
    throw Errors.fromResponse(503, {
      error: 'Invite-code generation is temporarily unavailable'
    })
  }

  const result =
    data && typeof data === 'object' ? (data as InviteBusinessFailure) : null
  const code = typeof result?.error_code === 'string' ? result.error_code : null
  const message = typeof result?.error === 'string' ? result.error : fallback

  if (code === 'NOT_FOUND') {
    throw Errors.fromResponse(404, { error: message })
  }
  if (
    code === 'INVALID_INPUT' ||
    code === 'ALREADY_CLAIMED' ||
    code === 'ALREADY_USED'
  ) {
    throw Errors.fromResponse(400, { error: message })
  }
  throw Errors.fromResponse(500, { error: fallback })
}
