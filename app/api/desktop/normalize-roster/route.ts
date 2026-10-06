import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { serviceDb } from '@/app/lib/db'
import { buildRosterSnapshotRows } from '@/app/lib/player/roster-sync'
import { parseRosterSnapshot } from '@/apps/desktop/launcher/roster-validation.mjs'

// Read-only canonical normalization. Trusted coordinator commits the result with
// the validated snapshot; this operation never receives a game API key.
export const POST = withErrorHandler(
  async (request: NextRequest) => {
    requireCronSecret(request)
    if (getRuntimeProfile() !== 'desktop')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    try {
      const reader = request.body?.getReader()
      if (!reader) throw new Error('Missing body')
      const parts: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 8 * 1024 * 1024) throw new Error('Body too large')
          parts.push(part.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const input = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (key) => !['contents', 'subject'].includes(key)
        ) ||
        typeof input.subject !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.subject)
      )
        throw new Error('Invalid context')
      const snapshot = parseRosterSnapshot(input.contents)
      const all = new Map(
        [...snapshot.units, ...snapshot.machinesOfWar].map((unit) => [
          unit.id,
          unit
        ])
      )
      if (all.size === 0) return NextResponse.json({ rows: [], unmapped: 0 })
      const supabase = serviceDb()
      const rows = await buildRosterSnapshotRows(
        input.subject,
        [...all.values()],
        [],
        supabase
      )
      const { data: mappings, error } = await supabase
        .from('hero_mappings')
        .select('id,unit_id')
        .in('unit_id', [...all.keys()])
      if (error) throw new Error('Catalogue unavailable')
      const unitIds = new Map(
        (mappings ?? []).map((mapping) => [mapping.id, mapping.unit_id])
      )
      const normalized = rows.map((row) => {
        const unitId = unitIds.get(row.hero_mapping_id),
          unit = unitId ? all.get(unitId) : undefined
        if (!unit) throw new Error('Catalogue changed')
        return {
          ...row,
          source_unit_id: unit.id,
          xp: unit.xp,
          shards: unit.shards,
          mythic_shards: unit.mythicShards,
          upgrades: unit.upgrades
        }
      })
      return NextResponse.json({
        rows: normalized,
        unmapped: all.size - normalized.length
      })
    } catch {
      return NextResponse.json(
        { error: 'Unsupported roster data. Existing roster was preserved.' },
        { status: 400 }
      )
    }
  },
  { maxJsonBodyBytes: () => 8 * 1024 * 1024 }
)
