import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilterPanel } from '@/app/(dashboard)/leaderboards/meta-analysis/_components/FilterPanel'
import { MetaAnalysisCalculationsFAQ } from '@/app/(dashboard)/leaderboards/meta-analysis/_components/MetaAnalysisFAQ'
import { useMetaAnalysisData } from '@/app/(dashboard)/leaderboards/meta-analysis/_hooks/useMetaAnalysisData'
import {
  META_ANALYSIS_GLOBAL_SCOPE_DETAIL,
  META_ANALYSIS_GLOBAL_SCOPE_NOTICE
} from '@/app/lib/meta/meta-analysis-scope'

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

/** The endpoints read a global aggregate with no guild parameter, so no guild selector may appear. */
describe('cluster meta analysis scope honesty', () => {
  describe('FilterPanel', () => {
    const baseProps = {
      selectedRarities: ['Mythic' as const],
      setSelectedRarities: vi.fn(),
      availableLevels: ['M1'],
      levelFilter: 'all',
      setLevelFilter: vi.fn(),
      availableMetaTeams: [],
      selectedMetaTeams: new Set<string>(),
      setSelectedMetaTeams: vi.fn(),
      recommendedLoading: false,
      onRefresh: vi.fn()
    }

    it('offers no guild selector, because no guild selection can reach the data', () => {
      render(<FilterPanel {...baseProps} scope="global" />)

      expect(screen.getAllByRole('combobox')).toHaveLength(1)
      expect(screen.queryByText('All Guilds (Cluster)')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('option', { name: /guild/i })
      ).not.toBeInTheDocument()
    })

    it('states the global scope visibly and points at the guild-scoped surface', () => {
      render(<FilterPanel {...baseProps} scope="global" />)

      const notice = screen.getByTestId('meta-analysis-scope-notice')
      expect(notice).toHaveTextContent(META_ANALYSIS_GLOBAL_SCOPE_NOTICE)
      expect(screen.getByRole('link', { name: /my guild/i })).toHaveAttribute(
        'href',
        '/meta-atlas?tab=my-guild'
      )
    })

    it('claims no scope before the first response declares one', () => {
      render(<FilterPanel {...baseProps} scope={null} />)

      expect(
        screen.queryByTestId('meta-analysis-scope-notice')
      ).not.toBeInTheDocument()
    })

    it('drops the global notice when the data actually is guild-scoped', () => {
      render(<FilterPanel {...baseProps} scope="guild" />)

      expect(
        screen.queryByTestId('meta-analysis-scope-notice')
      ).not.toBeInTheDocument()
    })
  })

  describe('MetaAnalysisCalculationsFAQ', () => {
    const openFaq = async () => {
      render(<MetaAnalysisCalculationsFAQ />)
      await userEvent.click(
        screen.getByRole('button', { name: /how meta analysis works/i })
      )
    }

    it('never instructs the reader to filter by guild', async () => {
      await openFaq()

      expect(screen.queryByText(/filter by guild/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/cluster-wide/i)).not.toBeInTheDocument()
    })

    it('states the same global scope the filter panel does', async () => {
      await openFaq()

      const scopeTip = screen.getByTestId('meta-analysis-faq-scope')
      expect(scopeTip).toHaveTextContent(META_ANALYSIS_GLOBAL_SCOPE_NOTICE)
      expect(scopeTip).toHaveTextContent(META_ANALYSIS_GLOBAL_SCOPE_DETAIL)
      expect(screen.getByRole('link', { name: /my guild/i })).toHaveAttribute(
        'href',
        '/meta-atlas?tab=my-guild'
      )
    })
  })

  describe('page metadata', () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        'app/(dashboard)/leaderboards/meta-analysis/page.tsx'
      ),
      'utf8'
    )

    it('does not brand a global surface as cluster-scoped', () => {
      expect(pageSource).toContain("title: 'Global Meta Analysis'")
      expect(pageSource).not.toContain("title: 'Cluster Meta Analysis'")
    })
  })

  describe('useMetaAnalysisData', () => {
    let requestedUrls: string[]

    const scopedBody = (data: unknown[]) => ({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data
    })

    const jsonResponse = (body: unknown) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body
    })

    beforeEach(() => {
      requestedUrls = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input)
          requestedUrls.push(url)

          if (url.includes('/api/meta-analysis/boss-names')) {
            return jsonResponse({ 'Mythic-0': 'Szarekh' })
          }
          if (url.includes('/api/meta-analysis/recommendations')) {
            return jsonResponse(scopedBody([]))
          }
          return jsonResponse(
            scopedBody([
              {
                compositionKey: 'team-1',
                compositionDisplay: 'Actus + Vitruvius',
                battlesCount: 20,
                avgDamage: 500
              }
            ])
          )
        })
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const renderData = () =>
      renderHook(() =>
        useMetaAnalysisData({
          season: '83',
          selectedRarities: ['Mythic'],
          setAvailableMetaTeams: vi.fn(),
          setAvailableLevels: vi.fn()
        })
      )

    it('never sends a guild filter the endpoints cannot honour', async () => {
      const { result } = renderData()

      await waitFor(() => expect(result.current.scope).not.toBeNull())
      await waitFor(() =>
        expect(
          requestedUrls.some((url) => url.includes('/api/meta-analysis?'))
        ).toBe(true)
      )

      expect(requestedUrls.length).toBeGreaterThan(0)
      expect(requestedUrls.some((url) => url.includes('guildFilter'))).toBe(
        false
      )
    })

    it('reads the rendered scope out of the response body', async () => {
      const { result } = renderData()

      await waitFor(() => expect(result.current.scope).toBe('global'))
    })

    it('reports global when any response is global, never the narrower claim', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input)
          requestedUrls.push(url)

          if (url.includes('/api/meta-analysis/boss-names')) {
            return jsonResponse({ 'Mythic-0': 'Szarekh' })
          }
          if (url.includes('/api/meta-analysis/recommendations')) {
            // A guild-scoped recommendations answer must not launder the global compositions.
            return jsonResponse({
              scope: 'guild',
              requestedGuildFilter: 'GUILD-A',
              guildFilterIgnored: false,
              data: []
            })
          }
          return jsonResponse(scopedBody([]))
        })
      )

      const { result } = renderData()

      await waitFor(() =>
        expect(
          requestedUrls.some((url) => url.includes('/api/meta-analysis?'))
        ).toBe(true)
      )
      await waitFor(() => expect(result.current.scope).toBe('global'))
    })
  })
})
