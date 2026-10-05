import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { normalizeRaidFile } from '@/app/lib/desktop/raid-file'
import type { BossMappings } from '@/app/lib/sync/transformers'

// Fixed internal normalization operation. The coordinator verifies the local
// account and derives mapping context; neither its credential nor this response
// is exposed to the renderer. This endpoint does not write data or make calls.
export const POST = withErrorHandler(async (request: NextRequest) => {
  requireCronSecret(request)
  if (getRuntimeProfile() !== 'desktop')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const parts: Uint8Array[] = []
    let size = 0
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Missing body')
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 16 * 1024 * 1024) {
          await reader.cancel()
          throw new Error('Body too large')
        }
        parts.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    const input = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (
      !input ||
      Object.keys(input).some((key) => !['contents', 'context'].includes(key))
    )
      throw new Error('Invalid input')
    const context = input.context
    if (
      !context ||
      Object.keys(context).some(
        (key) =>
          ![
            'guildCode',
            'playerMappings',
            'bossMappings',
            'clusterCode',
            'clusterId'
          ].includes(key)
      )
    )
      throw new Error('Invalid context')
    if (
      typeof context.guildCode !== 'string' ||
      !Array.isArray(context.playerMappings) ||
      context.playerMappings.length > 10000
    )
      throw new Error('Invalid mapping')
    for (const pair of context.playerMappings)
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some(
          (value) =>
            typeof value !== 'string' || !value.length || value.length > 128
        )
      )
        throw new Error('Invalid mapping')
    if (
      ![null, undefined].includes(context.clusterCode) &&
      (typeof context.clusterCode !== 'string' ||
        context.clusterCode.length > 20)
    )
      throw new Error('Invalid cluster')
    if (
      context.clusterId !== null &&
      context.clusterId !== undefined &&
      (typeof context.clusterId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(context.clusterId))
    )
      throw new Error('Invalid cluster')
    const mappings = context.bossMappings
    if (
      !mappings ||
      typeof mappings !== 'object' ||
      Array.isArray(mappings) ||
      Object.keys(mappings).length > 1000
    )
      throw new Error('Invalid bosses')
    for (const [boss, encounters] of Object.entries(mappings)) {
      if (
        !boss.length ||
        boss.length > 128 ||
        !encounters ||
        typeof encounters !== 'object' ||
        Array.isArray(encounters)
      )
        throw new Error('Invalid bosses')
      for (const [index, name] of Object.entries(encounters))
        if (
          !/^\d{1,4}$/.test(index) ||
          Number(index) > 1000 ||
          typeof name !== 'string' ||
          !name.length ||
          name.length > 128
        )
          throw new Error('Invalid bosses')
    }
    const rows = normalizeRaidFile(input.contents, {
      guildCode: context.guildCode,
      playerMappings: new Map(context.playerMappings as [string, string][]),
      bossMappings: mappings as BossMappings,
      clusterCode: context.clusterCode ?? null,
      clusterId: context.clusterId ?? null
    })
    return NextResponse.json({ rows })
  } catch {
    return NextResponse.json(
      { error: 'Invalid raid file. No data was imported.' },
      { status: 400 }
    )
  }
})
