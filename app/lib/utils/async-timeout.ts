export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/** Plain sleep; use resilience/with-retry.ts's sleep when abort matters. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 10000,
  operationName: string = 'operation'
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(
          `${operationName} timed out after ${timeoutMs}ms`,
          timeoutMs
        )
      )
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    return result
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

const RESPONSE_BODY_METHODS = [
  'json',
  'text',
  'arrayBuffer',
  'blob',
  'formData'
] as const

type ResponseBodyMethod = (typeof RESPONSE_BODY_METHODS)[number]

type ResponseBodyTimeoutOptions = {
  onTimeout?: () => void
}

function cancelBody(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // Body may already be locked or consumed.
  }
}

function runOnTimeout(options?: ResponseBodyTimeoutOptions) {
  try {
    options?.onTimeout?.()
  } catch {
    // Timeout cleanup is best-effort.
  }
}

export function withResponseBodyTimeout(
  response: Response,
  timeoutMs: number = 10000,
  operationName: string = 'response body',
  options?: ResponseBodyTimeoutOptions
): Response {
  const wrapped = response as Response &
    Record<ResponseBodyMethod, () => Promise<unknown>>

  for (const method of RESPONSE_BODY_METHODS) {
    const readBody = wrapped[method]
    if (typeof readBody !== 'function') continue

    Object.defineProperty(wrapped, method, {
      configurable: true,
      value: async () => {
        try {
          return await withTimeout(
            Promise.resolve(readBody.call(response)),
            timeoutMs,
            `${operationName} ${method}`
          )
        } catch (error) {
          if (error instanceof TimeoutError) {
            runOnTimeout(options)
          }
          cancelBody(response)
          throw error
        }
      }
    })
  }

  return response
}

export async function withTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  options: {
    timeoutMs?: number
    maxRetries?: number
    retryDelayMs?: number
    operationName?: string
    shouldRetry?: (error: Error, attempt: number) => boolean
  } = {}
): Promise<T> {
  const {
    timeoutMs = 10000,
    maxRetries = 2,
    retryDelayMs = 1000,
    operationName = 'operation',
    shouldRetry = (error) => error instanceof TimeoutError
  } = options

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, operationName)
    } catch (error) {
      lastError = error as Error

      if (attempt === maxRetries || !shouldRetry(lastError, attempt)) {
        throw lastError
      }

      const delay = retryDelayMs * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

export const SERVICE_TIMEOUTS = {
  RESEND_EMAIL: 15000, // 15 seconds for email
  DISCORD_WEBHOOK: 10000, // 10 seconds for Discord
  EXTERNAL_API: 30000 // 30 seconds for external APIs
} as const
