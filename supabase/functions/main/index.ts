// Self-hosted Edge Runtime entry point: routes each request to a user worker.
// Based on https://github.com/supabase/self-hosted-edge-functions-demo

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import { overrideHandoffEnv } from '../_shared/loki-config-override-handoff.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'

const memoryLimitMb = 512
const workerTimeoutMs = 5 * 60 * 1000 // 5 minutes
const cpuTimeSoftLimitMs = 10_000 // 10s soft warning (default ~200ms)
const cpuTimeHardLimitMs = 20_000 // 20s hard kill (default ~200ms)
const noModuleCache = false
const importMapPath =
  Deno.env.get('IMPORT_MAP_PATH') || '/home/deno/functions/deno.json'

const envVarsObj = Deno.env.toObject()
const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]])

// Allowlist: only these directories may be spawned as workers.
const VALID_FUNCTIONS = new Set([
  'sync-modular-workflow',
  'discord-bot-oauth',
  'boss-assignment-solver',
  'check-capped-players',
  'calculate-votlw',
  'detect-season-end',
  'daily-summary',
  'gr-availability',
  'meta-atlas',
  'historical-backfill-modular',
  'process-cap-notifications',
  'process-log-exports',
  'admin-enable-modular-sync',
  'update-discord-leaderboards',
  'refresh-guild-snapshots'
])

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  try {
    const url = new URL(req.url)
    const pathname = url.pathname
    const pathParts = pathname.split('/').filter(Boolean)

    // Accepts /functions/v1/{name}, /functions/{name} and /{name}.
    let serviceName = pathParts[0]

    if (serviceName === 'functions') {
      serviceName = pathParts[2] || pathParts[1]
    }

    if (
      !serviceName ||
      serviceName === '' ||
      serviceName === 'health' ||
      serviceName === 'main'
    ) {
      return jsonResponse({
        status: 'ok',
        timestamp: new Date().toISOString(),
        mode: 'edge-runtime-router',
        availableFunctions: Array.from(VALID_FUNCTIONS)
      })
    }

    if (!VALID_FUNCTIONS.has(serviceName)) {
      return jsonResponse(
        {
          error: 'Function not found',
          function: serviceName,
          availableFunctions: Array.from(VALID_FUNCTIONS)
        },
        { status: 404 }
      )
    }

    const servicePath = `/home/deno/functions/${serviceName}`

    console.log(
      `[router] Routing to function: ${serviceName} at ${servicePath}`
    )

    // @ts-ignore - EdgeRuntime is provided by the runtime
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      cpuTimeSoftLimitMs,
      cpuTimeHardLimitMs,
      noModuleCache,
      importMapPath,
      envVars: [
        ...Object.entries(Deno.env.toObject()),
        ...(await overrideHandoffEnv())
      ]
    })

    const response = await worker.fetch(req)

    const headers = new Headers(response.headers)
    Object.entries(corsHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  } catch (error) {
    console.error('[router] Error:', error)

    return jsonResponse(
      {
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
})
