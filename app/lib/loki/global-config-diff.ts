import { validateDiscordWebhookUrl } from '@/app/lib/webhooks/validate-url'

interface Encounter {
  bossType?: string
  encounterIndex?: number
  guildBossEncounterType?: string
}
interface SeasonSet {
  set?: number
  encounters?: Encounter[]
}
interface SeasonTier {
  tier?: number
  sets?: SeasonSet[]
}
interface SeasonConfig {
  tiers?: SeasonTier[]
  loopFromTier?: number | string | null
  loopFromSet?: number | string | null
}
interface GuildBoss {
  guildBossSeasonConfigRotation?: unknown[]
  guildBossSeasonDataConfigsGDTO?: Record<string, SeasonConfig>
  misc?: {
    seasonDuration?: number
    firstSeasonStart?: number | string
    bufferAfterSeasonEnd?: number
  }
}
export interface GlobalConfigShape {
  configVersion?: string
  extractedAt?: string
  guildBoss?: GuildBoss
  guildWar?: unknown
}

export interface ConfigDiff {
  versionChanged: boolean
  oldVersion: string
  newVersion: string
  lines: string[]
}

function bossRoster(cfg: SeasonConfig | undefined): Set<string> {
  const out = new Set<string>()
  for (const tier of cfg?.tiers ?? []) {
    for (const set of tier?.sets ?? []) {
      for (const enc of set?.encounters ?? []) {
        if (enc?.bossType) out.add(enc.bossType)
      }
    }
  }
  return out
}

function setDiff(
  oldSet: Set<string>,
  newSet: Set<string>
): { added: string[]; removed: string[] } {
  const added = [...newSet].filter((x) => !oldSet.has(x)).sort()
  const removed = [...oldSet].filter((x) => !newSet.has(x)).sort()
  return { added, removed }
}

export function diffGlobalConfig(
  oldCfg: GlobalConfigShape,
  newCfg: GlobalConfigShape,
  pretty: (bossType: string) => string = (b) => b
): ConfigDiff {
  const oldVersion = oldCfg.configVersion ?? '(none)'
  const newVersion = newCfg.configVersion ?? '(none)'
  const lines: string[] = []

  if (oldCfg.extractedAt !== newCfg.extractedAt) {
    lines.push(
      `extractedAt: ${oldCfg.extractedAt ?? '(none)'} → ${newCfg.extractedAt ?? '(none)'}`
    )
  }

  const oldGdto = oldCfg.guildBoss?.guildBossSeasonDataConfigsGDTO ?? {}
  const newGdto = newCfg.guildBoss?.guildBossSeasonDataConfigsGDTO ?? {}
  const oldKeys = new Set(Object.keys(oldGdto))
  const newKeys = new Set(Object.keys(newGdto))

  for (const k of [...newKeys].filter((k) => !oldKeys.has(k)).sort()) {
    lines.push(`NEW season config: ${k}`)
  }
  for (const k of [...oldKeys].filter((k) => !newKeys.has(k)).sort()) {
    lines.push(`REMOVED season config: ${k}`)
  }

  for (const k of [...newKeys].filter((k) => oldKeys.has(k)).sort()) {
    const { added, removed } = setDiff(
      bossRoster(oldGdto[k]),
      bossRoster(newGdto[k])
    )
    if (added.length || removed.length) {
      const parts: string[] = []
      if (added.length) parts.push(`+${added.map(pretty).join(', ')}`)
      if (removed.length) parts.push(`-${removed.map(pretty).join(', ')}`)
      lines.push(`${k}: ${parts.join('  ')}`)
    }

    for (const field of ['loopFromTier', 'loopFromSet'] as const) {
      const oldValue = oldGdto[k]?.[field]
      const newValue = newGdto[k]?.[field]
      if (oldValue !== newValue) {
        lines.push(
          `${k}.${field}: ${String(oldValue ?? '(none)')} → ${String(newValue ?? '(none)')}`
        )
      }
    }
  }

  const oldRot = JSON.stringify(
    oldCfg.guildBoss?.guildBossSeasonConfigRotation ?? null
  )
  const newRot = JSON.stringify(
    newCfg.guildBoss?.guildBossSeasonConfigRotation ?? null
  )
  if (oldRot !== newRot) {
    lines.push(`season rotation changed: ${oldRot} → ${newRot}`)
  }

  const oldMisc = oldCfg.guildBoss?.misc ?? {}
  const newMisc = newCfg.guildBoss?.misc ?? {}
  for (const f of [
    'seasonDuration',
    'firstSeasonStart',
    'bufferAfterSeasonEnd'
  ] as const) {
    if (oldMisc[f] !== newMisc[f]) {
      lines.push(`misc.${f}: ${String(oldMisc[f])} → ${String(newMisc[f])}`)
    }
  }

  return {
    versionChanged: oldVersion !== newVersion,
    oldVersion,
    newVersion,
    lines
  }
}

const DISCORD_MAX = 1900 // leave headroom under the 2000-char content limit

export function formatDiscordContent(diff: ConfigDiff): string {
  const head =
    `**LOKI GlobalConfig drift detected**\n` +
    `version \`${diff.oldVersion.slice(0, 8)}\` → \`${diff.newVersion.slice(0, 8)}\`\n` +
    `The deployed app's game config is now stale vs LOKI. Review and check in ` +
    `data/loki-api/GlobalConfig.json, then run \`npm run loki:season-lineups\`; ` +
    `deploy the reviewed change separately.`

  const body = diff.lines.length
    ? '\n\n**Changes:**\n' + diff.lines.map((l) => `• ${l}`).join('\n')
    : '\n\n(version hash changed but no app-consumed fields differed)'

  let msg = head + body
  if (msg.length > DISCORD_MAX) {
    msg = msg.slice(0, DISCORD_MAX - 20) + '\n…(truncated)'
  }
  return msg
}

export function isDiscordWebhookUrl(
  url: string | undefined | null
): url is string {
  return validateDiscordWebhookUrl(url).ok
}

/** Worker pods hit intermittent DNS failures (EAI_AGAIN etc.) that succeed on retry. */
export function isRetryableNetworkError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('eai_again') ||
    m.includes('enotfound') ||
    m.includes('fetch failed') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('econnrefused') ||
    m.includes('socket hang up') ||
    m.includes('und_err') ||
    m.includes('network')
  )
}

export interface AppStartResponse {
  eventResult?: {
    eventResultType?: string
    eventResponseData?: { latestGlobalGameConfigVersion?: string }
    failure?: unknown
    errorCode?: string | null
    errorMessage?: string | null
  }
  latestGlobalGameConfigVersion?: string
}

/** Without `latestGlobalGameConfigVersion` a success means up to date: LOKI sends it only when newer. */
export function parseAppStartLatestHash(
  data: AppStartResponse,
  currentHash: string
): string {
  const er = data?.eventResult
  const latest =
    er?.eventResponseData?.latestGlobalGameConfigVersion ??
    data?.latestGlobalGameConfigVersion ??
    null
  if (latest) return latest // drift: server advertised a newer config version

  const isSuccess =
    er?.eventResultType === 'SUCCESS' ||
    (!!er?.eventResponseData && !er?.failure)
  if (isSuccess) return currentHash // no drift: field omitted on an up-to-date client

  const reason =
    er?.errorMessage ||
    er?.errorCode ||
    er?.eventResultType ||
    'unknown APP_START failure'
  throw new Error(`APP_START did not succeed: ${String(reason)}`)
}
