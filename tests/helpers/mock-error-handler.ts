/** Use via vi.doMock(..., () => withErrorHandlerMock) or an async vi.mock import. */

export const withErrorHandlerMock = {
  withErrorHandler:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    async (...args: unknown[]) => {
      try {
        return await handler(...args)
      } catch (error) {
        const e = error as {
          status?: number
          statusCode?: number
          body?: unknown
          message?: string
        }
        const status = e?.status ?? e?.statusCode ?? 500
        const body = e?.body ?? { error: e?.message ?? 'Internal server error' }
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
}
