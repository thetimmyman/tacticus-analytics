import { describe, expect, it } from 'vitest'
import {
  annotateMixedMetaAnalysisScope,
  buildGlobalMetaAnalysisPayload,
  readMetaAnalysisScopedPayload,
  resolveFilteredMetaAnalysisScope,
  widenMetaAnalysisScope
} from '@/app/lib/meta/meta-analysis-scope'

/** The RPC has no guild parameter, so the body declares global scope. */
describe('meta-analysis scope contract', () => {
  describe('buildGlobalMetaAnalysisPayload', () => {
    it('labels an unfiltered response global with nothing ignored', () => {
      expect(buildGlobalMetaAnalysisPayload([1, 2, 3])).toEqual({
        scope: 'global',
        requestedGuildFilter: null,
        guildFilterIgnored: false,
        data: [1, 2, 3]
      })
    })

    it('records a requested guild filter as ignored rather than honoured', () => {
      expect(buildGlobalMetaAnalysisPayload([], 'GUILD-A')).toEqual({
        scope: 'global',
        requestedGuildFilter: 'GUILD-A',
        guildFilterIgnored: true,
        data: []
      })
    })

    it('treats a blank guild filter as no filter at all', () => {
      expect(buildGlobalMetaAnalysisPayload([], '   ')).toMatchObject({
        requestedGuildFilter: null,
        guildFilterIgnored: false
      })
      expect(buildGlobalMetaAnalysisPayload([], null)).toMatchObject({
        requestedGuildFilter: null,
        guildFilterIgnored: false
      })
    })
  })

  describe('readMetaAnalysisScopedPayload', () => {
    it('reads a scoped envelope back unchanged', () => {
      expect(
        readMetaAnalysisScopedPayload({
          scope: 'guild',
          requestedGuildFilter: 'GUILD-A',
          guildFilterIgnored: false,
          data: ['row']
        })
      ).toEqual({
        scope: 'guild',
        requestedGuildFilter: 'GUILD-A',
        guildFilterIgnored: false,
        data: ['row']
      })
    })

    it('reports a bare array as global, since it makes no scope claim', () => {
      expect(readMetaAnalysisScopedPayload(['row'])).toEqual({
        scope: 'global',
        requestedGuildFilter: null,
        guildFilterIgnored: false,
        data: ['row']
      })
    })

    it('never invents a narrower scope from an unrecognised payload', () => {
      for (const body of [null, undefined, 'nope', 42, {}]) {
        expect(readMetaAnalysisScopedPayload(body).scope).toBe('global')
      }
      expect(readMetaAnalysisScopedPayload({ scope: 'roster' }).scope).toBe(
        'global'
      )
      expect(readMetaAnalysisScopedPayload({ scope: 42 }).scope).toBe('global')
    })

    it('reads the cluster scope the batch endpoint can genuinely answer at', () => {
      expect(readMetaAnalysisScopedPayload({ scope: 'cluster' }).scope).toBe(
        'cluster'
      )
    })

    it('drops a non-array data field instead of rendering garbage', () => {
      expect(
        readMetaAnalysisScopedPayload({ scope: 'global', data: 'oops' }).data
      ).toEqual([])
    })
  })

  describe('widenMetaAnalysisScope', () => {
    it('lets global win over guild for a view built from several responses', () => {
      expect(widenMetaAnalysisScope(null, 'global')).toBe('global')
      expect(widenMetaAnalysisScope('guild', 'global')).toBe('global')
      expect(widenMetaAnalysisScope('global', 'guild')).toBe('global')
      expect(widenMetaAnalysisScope(null, 'guild')).toBe('guild')
      expect(widenMetaAnalysisScope('guild', 'guild')).toBe('guild')
    })

    it('keeps the broadest scope when cluster sits between guild and global', () => {
      expect(widenMetaAnalysisScope('guild', 'cluster')).toBe('cluster')
      expect(widenMetaAnalysisScope('cluster', 'guild')).toBe('cluster')
      expect(widenMetaAnalysisScope('cluster', 'global')).toBe('global')
      expect(widenMetaAnalysisScope('global', 'cluster')).toBe('global')
      expect(widenMetaAnalysisScope(null, 'cluster')).toBe('cluster')
    })
  })

  describe('resolveFilteredMetaAnalysisScope', () => {
    it('mirrors the p_guild_filter / p_cluster_code predicate pair', () => {
      expect(resolveFilteredMetaAnalysisScope('GUILD-A', 'EOT')).toBe('guild')
      expect(resolveFilteredMetaAnalysisScope(null, 'EOT')).toBe('cluster')
      expect(resolveFilteredMetaAnalysisScope(null, null)).toBe('global')
      expect(resolveFilteredMetaAnalysisScope('  ', '  ')).toBe('global')
      expect(resolveFilteredMetaAnalysisScope(undefined, undefined)).toBe(
        'global'
      )
    })
  })

  describe('annotateMixedMetaAnalysisScope', () => {
    it('keeps section scopes distinct and reports the broadest as effective', () => {
      expect(
        annotateMixedMetaAnalysisScope(
          { compositions: 'global', recommendedTeams: 'guild' },
          'GUILD-A'
        )
      ).toEqual({
        scope: { compositions: 'global', recommendedTeams: 'guild' },
        effectiveScope: 'global',
        requestedGuildFilter: 'GUILD-A',
        guildFilterIgnored: true
      })
    })

    it('does not call a guild filter ignored when every section honours it', () => {
      expect(
        annotateMixedMetaAnalysisScope({ recommendedTeams: 'guild' }, 'GUILD-A')
      ).toMatchObject({
        effectiveScope: 'guild',
        guildFilterIgnored: false
      })
    })

    it('reports nothing ignored when no guild filter was requested', () => {
      expect(
        annotateMixedMetaAnalysisScope(
          { compositions: 'global', recommendedTeams: 'cluster' },
          null
        )
      ).toMatchObject({
        effectiveScope: 'global',
        requestedGuildFilter: null,
        guildFilterIgnored: false
      })
    })
  })
})
