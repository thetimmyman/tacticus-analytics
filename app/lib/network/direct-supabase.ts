// For cron jobs and long-running routes: the SDK's PostgREST .then() hangs under Sentry/OTel.

import { getSharedFetch } from './undici-agent'

interface DirectSupabaseConfig {
  baseUrl: string
  serviceKey: string
  anonKey: string
}

function getConfig(): DirectSupabaseConfig {
  return {
    baseUrl:
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  }
}

function authHeaders(config: DirectSupabaseConfig): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json'
  }
}

export function createDirectClient() {
  const config = getConfig()
  const fetch = getSharedFetch()
  const headers = authHeaders(config)

  return {
    async query<T = unknown>(
      path: string
    ): Promise<{ data: T | null; error: string | null }> {
      try {
        const resp = await fetch(`${config.baseUrl}/rest/v1/${path}`, {
          method: 'GET',
          headers
        })
        if (!resp.ok) {
          const errText = await resp.text()
          return { data: null, error: `HTTP ${resp.status}: ${errText}` }
        }
        const data = (await resp.json()) as T
        return { data, error: null }
      } catch (err) {
        return {
          data: null,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    },

    async rpc<T = unknown>(
      functionName: string,
      args: Record<string, unknown> = {}
    ): Promise<{ data: T | null; error: string | null }> {
      try {
        const resp = await fetch(
          `${config.baseUrl}/rest/v1/rpc/${functionName}`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(args)
          }
        )
        if (!resp.ok) {
          const errText = await resp.text()
          return { data: null, error: `HTTP ${resp.status}: ${errText}` }
        }
        const data = (await resp.json()) as T
        return { data, error: null }
      } catch (err) {
        return {
          data: null,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    },

    async invoke<T = unknown>(
      functionName: string,
      body: Record<string, unknown> = {}
    ): Promise<{ data: T | null; error: string | null }> {
      try {
        const resp = await fetch(
          `${config.baseUrl}/functions/v1/${functionName}`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          }
        )
        if (!resp.ok) {
          const errText = await resp.text()
          return { data: null, error: `HTTP ${resp.status}: ${errText}` }
        }
        const data = (await resp.json()) as T
        return { data, error: null }
      } catch (err) {
        return {
          data: null,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    },

    async mutate<T = unknown>(
      path: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body?: Record<string, unknown>,
      extraHeaders?: Record<string, string>
    ): Promise<{ data: T | null; error: string | null }> {
      try {
        const resp = await fetch(`${config.baseUrl}/rest/v1/${path}`, {
          method,
          headers: { ...headers, ...extraHeaders },
          body: body ? JSON.stringify(body) : undefined
        })
        if (!resp.ok) {
          const errText = await resp.text()
          return { data: null, error: `HTTP ${resp.status}: ${errText}` }
        }
        if (resp.status === 204) {
          return { data: null, error: null }
        }
        const data = (await resp.json()) as T
        return { data, error: null }
      } catch (err) {
        return {
          data: null,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    },

    async count(
      path: string
    ): Promise<{ count: number | null; error: string | null }> {
      try {
        const resp = await fetch(`${config.baseUrl}/rest/v1/${path}`, {
          method: 'HEAD',
          headers: { ...headers, Prefer: 'count=exact' }
        })
        if (!resp.ok) {
          return { count: null, error: `HTTP ${resp.status}` }
        }
        const contentRange = resp.headers.get('content-range')
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/)
          const countText = match?.[1]
          if (countText) return { count: parseInt(countText, 10), error: null }
        }
        return { count: null, error: null }
      } catch (err) {
        return {
          count: null,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  }
}

export type DirectClient = ReturnType<typeof createDirectClient>
