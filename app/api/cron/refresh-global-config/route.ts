import { NextRequest, NextResponse } from 'next/server'
import { gzipSync } from 'node:zlib'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { logger } from '@/app/lib/logging/logger'
import { prettyBossName } from '@/app/lib/loki/season-configs'
import {
  diffGlobalConfig,
  formatDiscordContent,
  isDiscordWebhookUrl
} from '@/app/lib/loki/global-config-diff'
import {
  discoverLatestHash,
  fetchGlobalConfig,
  postDiscordWebhook,
  readEffectiveGlobalConfig
} from '@/app/lib/loki/global-config-refresh'
import { isSafeContentsRoll } from '@/app/lib/loki/config-safety'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = logger.child({ component: 'loki-globalconfig-refresh' })

/** Drift detection: posts a diff, never writes config. Epoch/rotation changes stay manual. */
async function handle(
  force: boolean,
  payloadMode = false
): Promise<NextResponse> {
  const userId = process.env.LOKI_SCRAPER_USER_ID
  if (!userId) {
    throw Errors.fromResponse(500, {
      error: 'LOKI_SCRAPER_USER_ID is not configured'
    })
  }

  const effective = readEffectiveGlobalConfig()
  log.info(
    {
      effectiveVersion: effective.configVersion,
      bakedVersion: effective.bakedVersion,
      overrideActive: effective.overrideActive === true,
      extractedAt: effective.extractedAt
    },
    'checking LOKI config drift'
  )

  const latestHash = await discoverLatestHash(userId, effective.configVersion)
  const changed = latestHash !== effective.configVersion

  if (!changed && !force) {
    log.info({ version: latestHash }, 'LOKI GlobalConfig up to date — no-op')
    return NextResponse.json({
      changed: false,
      configVersion: latestHash,
      effectiveVersion: effective.configVersion,
      bakedVersion: effective.bakedVersion,
      overrideActive: effective.overrideActive === true,
      message: 'up to date'
    })
  }

  const liveConfig = await fetchGlobalConfig(latestHash)
  // CDN payloads omit both; without extractedAt no override is ever strictly newer.
  liveConfig.configVersion = latestHash
  liveConfig.extractedAt = new Date().toISOString()

  if (payloadMode) {
    const guardSafe = changed && isSafeContentsRoll(effective.raw, liveConfig)
    const payloadGzB64 = changed
      ? gzipSync(Buffer.from(JSON.stringify(liveConfig), 'utf8')).toString(
          'base64'
        )
      : null
    log.info(
      {
        changed,
        guardSafe,
        configVersion: latestHash,
        payloadB64Chars: payloadGzB64?.length ?? 0
      },
      'LOKI GlobalConfig payload mode'
    )
    return NextResponse.json({
      changed,
      guardSafe,
      configVersion: latestHash,
      effectiveVersion: effective.configVersion,
      bakedVersion: effective.bakedVersion,
      overrideActive: effective.overrideActive === true,
      payloadGzB64
    })
  }

  const diff = diffGlobalConfig(effective.raw, liveConfig, (b) =>
    prettyBossName(b)
  )
  const content = formatDiscordContent(diff)

  const webhookUrl = process.env.MONITORING_WEBHOOK_URL
  let notified = false
  if (isDiscordWebhookUrl(webhookUrl)) {
    const result = await postDiscordWebhook(webhookUrl, content)
    notified = result.ok
    if (!notified)
      log.warn(
        { detail: result.detail },
        'failed to POST drift alert to MONITORING_WEBHOOK_URL'
      )
  } else {
    log.warn(
      'MONITORING_WEBHOOK_URL not configured or not a Discord webhook — drift logged only'
    )
  }

  log.info(
    {
      oldVersion: diff.oldVersion,
      newVersion: diff.newVersion,
      changeCount: diff.lines.length,
      notified,
      forced: force && !changed
    },
    'LOKI GlobalConfig drift detected'
  )

  return NextResponse.json({
    changed,
    forced: force && !changed,
    oldVersion: diff.oldVersion,
    newVersion: diff.newVersion,
    notified,
    changes: diff.lines
  })
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  requireCronSecret(request)
  let force = false
  let payloadMode = false
  try {
    const body = (await request.json()) as { force?: boolean; mode?: string }
    force = body?.force === true
    payloadMode = body?.mode === 'payload'
  } catch {
    // Empty/non-JSON body: defaults apply.
  }
  try {
    return await handle(force, payloadMode)
  } catch (error) {
    rethrowIfAppError(error)
    // Upstream LOKI error text can carry request identifiers.
    log.error(
      { err: error instanceof Error ? error.message : String(error) },
      'LOKI GlobalConfig refresh failed'
    )
    throw Errors.fromResponse(500, {
      error: 'LOKI GlobalConfig refresh failed'
    })
  }
})

// GET ?force=true re-posts even when unchanged.
export const GET = withErrorHandler(async (request: NextRequest) => {
  requireCronSecret(request)
  const force = request.nextUrl.searchParams.get('force') === 'true'
  try {
    return await handle(force)
  } catch (error) {
    rethrowIfAppError(error)
    log.error(
      { err: error instanceof Error ? error.message : String(error) },
      'LOKI GlobalConfig refresh failed'
    )
    throw Errors.fromResponse(500, {
      error: 'LOKI GlobalConfig refresh failed'
    })
  }
})
