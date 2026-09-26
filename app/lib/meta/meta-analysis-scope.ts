// No `get_meta_atlas_*` RPC takes a guild, so these routes return GLOBAL data and say so; the UI
// offers no guild selector rather than one that silently does nothing.

export type MetaAnalysisScope = 'guild' | 'cluster' | 'global'

const SCOPE_BREADTH: Record<MetaAnalysisScope, number> = {
  guild: 0,
  cluster: 1,
  global: 2
}

function isMetaAnalysisScope(value: unknown): value is MetaAnalysisScope {
  return typeof value === 'string' && value in SCOPE_BREADTH
}

export interface MetaAnalysisScopedPayload<T> {
  scope: MetaAnalysisScope
  /** Echoed back, never widened. */
  requestedGuildFilter: string | null
  guildFilterIgnored: boolean
  data: T[]
}

export const META_ANALYSIS_GLOBAL_SCOPE_NOTICE =
  'Showing global data across all guilds'

export const META_ANALYSIS_GLOBAL_SCOPE_DETAIL =
  'these numbers cannot be narrowed to one guild'

export const META_ANALYSIS_MY_GUILD_HREF = '/meta-atlas?tab=my-guild'
export const META_ANALYSIS_MY_GUILD_LINK_LABEL = 'Meta Atlas → My Guild'

export function buildGlobalMetaAnalysisPayload<T>(
  data: T[],
  requestedGuildFilter?: string | null
): MetaAnalysisScopedPayload<T> {
  const requested = requestedGuildFilter?.trim() || null

  return {
    scope: 'global',
    requestedGuildFilter: requested,
    guildFilterIgnored: requested !== null,
    data
  }
}

/** Anything without a scope claim (e.g. a bare array) reads as global. */
export function readMetaAnalysisScopedPayload<T>(
  body: unknown
): MetaAnalysisScopedPayload<T> {
  if (Array.isArray(body)) {
    return {
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: body as T[]
    }
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const requested =
      typeof record.requestedGuildFilter === 'string' &&
      record.requestedGuildFilter.trim()
        ? record.requestedGuildFilter.trim()
        : null

    return {
      scope: isMetaAnalysisScope(record.scope) ? record.scope : 'global',
      requestedGuildFilter: requested,
      guildFilterIgnored: record.guildFilterIgnored === true,
      data: Array.isArray(record.data) ? (record.data as T[]) : []
    }
  }

  return {
    scope: 'global',
    requestedGuildFilter: null,
    guildFilterIgnored: false,
    data: []
  }
}

/** The BROADEST scope wins: a guild + global view is global. */
export function widenMetaAnalysisScope(
  current: MetaAnalysisScope | null,
  next: MetaAnalysisScope
): MetaAnalysisScope {
  if (current === null) return next
  return SCOPE_BREADTH[current] >= SCOPE_BREADTH[next] ? current : next
}

export interface MetaAnalysisSectionScopes {
  [section: string]: MetaAnalysisScope
}

export interface MetaAnalysisMixedScopeAnnotation {
  scope: MetaAnalysisSectionScopes
  effectiveScope: MetaAnalysisScope
  requestedGuildFilter: string | null
  guildFilterIgnored: boolean
}

export function annotateMixedMetaAnalysisScope(
  sections: MetaAnalysisSectionScopes,
  requestedGuildFilter?: string | null
): MetaAnalysisMixedScopeAnnotation {
  const requested = requestedGuildFilter?.trim() || null
  const scopes = Object.values(sections)
  const effectiveScope = scopes.reduce<MetaAnalysisScope | null>(
    (widest, next) => widenMetaAnalysisScope(widest, next),
    null
  )

  return {
    scope: sections,
    effectiveScope: effectiveScope ?? 'global',
    requestedGuildFilter: requested,
    guildFilterIgnored:
      requested !== null && scopes.some((scope) => scope !== 'guild')
  }
}

/** Mirrors the guild/cluster filter predicates in get_recommended_teams_for_season. */
export function resolveFilteredMetaAnalysisScope(
  guildFilter: string | null | undefined,
  clusterCode: string | null | undefined
): MetaAnalysisScope {
  if (guildFilter?.trim()) return 'guild'
  if (clusterCode?.trim()) return 'cluster'
  return 'global'
}
