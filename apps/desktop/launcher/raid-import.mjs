import {
  nativeSessionRequest,
  browserWorkspaceToken,
  workspaceAuthorized
} from './workspace-session.mjs'
import { createHash } from 'node:crypto'
import { parseRaidFile } from './raid-file-validation.mjs'

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const reply = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(value))
}
export function workspaceRaidImport(services, { normalize, brokerToken }) {
  let busy = false,
    nextAttempt = 0
  return async (req, res, url) => {
    if (url.pathname !== '/desktop/import') return false
    if (req.method !== 'POST') return false
    if (busy || Date.now() < nextAttempt) {
      reply(res, 429, { error: 'Please wait before trying import again.' })
      return true
    }
    busy = true
    nextAttempt = Date.now() + 3000
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 16 * 1024 * 1024) {
          reply(res, 413, { error: 'Raid file is too large.' })
          return true
        }
        chunks.push(chunk)
      }
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        reply(res, 400, { error: 'Invalid raid file. No data was imported.' })
        return true
      }
      if (
        !input ||
        typeof input !== 'object' ||
        Object.keys(input).some(
          (key) => !['password', 'contents'].includes(key)
        ) ||
        (!nativeSessionRequest(req, brokerToken) &&
          !browserWorkspaceToken(req) &&
          (typeof input.password !== 'string' ||
            input.password.length < 12 ||
            input.password.length > 128)) ||
        typeof input.contents !== 'string' ||
        Buffer.byteLength(input.contents) > 8 * 1024 * 1024
      ) {
        reply(res, 400, {
          error: 'Choose a supported raid file in your local workspace.'
        })
        return true
      }
      const file = parseRaidFile(input.contents)
      const record = JSON.parse(
        (
          await services.psql(`SELECT coalesce((SELECT json_build_object('subject',s.subject_user_id,'guildCode',s.guild_code,'clusterCode',g.cluster_code,'clusterId',g.cluster_id,
        'playerMappings',coalesce((SELECT json_agg(json_build_array(p.player_id,p.display_name)) FROM public.player_mapping p WHERE p.guild_code=s.guild_code AND p.is_current),'[]'::json),
        'bossMappings',coalesce((SELECT jsonb_object_agg(b.boss_type,b.entries) FROM (SELECT boss_type,jsonb_object_agg(encounter_index,boss_name) entries FROM public.boss_mapping GROUP BY boss_type) b),'{}'::jsonb)) FROM public.desktop_preview_setup s JOIN public.guild_config g ON g.guild_code=s.guild_code WHERE s.singleton),'null'::json);`)
        ).trim()
      )
      if (!record || !/^[a-f0-9-]{36}$/.test(record.subject)) {
        reply(res, 409, { error: 'Create a workspace before importing data.' })
        return true
      }
      if (file.guildCode !== record.guildCode) {
        reply(res, 400, {
          error: 'This file belongs to a different guild. No data was imported.'
        })
        return true
      }
      if (
        !(await workspaceAuthorized(
          services,
          req,
          input,
          record.subject,
          brokerToken,
          { allowBrowserSession: true }
        ))
      ) {
        reply(res, 401, {
          error: 'Reopen the app to restore your local session.'
        })
        return true
      }
      const rows = await normalize(input.contents, {
        guildCode: record.guildCode,
        playerMappings: record.playerMappings,
        bossMappings: record.bossMappings,
        clusterCode: record.clusterCode,
        clusterId: record.clusterId
      })
      const fingerprint = createHash('sha256')
        .update(input.contents)
        .digest('hex')
      const result = JSON.parse(
        (
          await services.psql(`BEGIN;
        SELECT set_config('request.jwt.claims',${quote(JSON.stringify({ sub: record.subject, role: 'authenticated' }))},true);
        SELECT 'desktop-import-result:'||public.desktop_import_raid(${quote(fingerprint)},${quote(JSON.stringify(rows))}::jsonb)::text;
        COMMIT;`)
        )
          .trim()
          .split('\n')
          .find((line) => line.startsWith('desktop-import-result:'))
          ?.slice('desktop-import-result:'.length)
      )
      reply(res, 200, result)
    } catch {
      reply(res, 400, {
        error:
          'Import failed. Existing data was preserved. Check the file format, guild code and available disk space.'
      })
    } finally {
      busy = false
    }
    return true
  }
}
