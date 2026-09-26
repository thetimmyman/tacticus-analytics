import { describe, it, expect } from 'vitest'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'

describe('Navigation Utilities', () => {
  describe('getHrefWithSeason', () => {
    it('returns href unchanged when season is null', () => {
      expect(getHrefWithSeason('/dashboard', null)).toBe('/dashboard')
      expect(getHrefWithSeason('/analytics/player', null)).toBe(
        '/analytics/player'
      )
    })

    it('returns root path unchanged', () => {
      expect(getHrefWithSeason('/', '100')).toBe('/')
      expect(getHrefWithSeason('/', null)).toBe('/')
    })

    it('adds season parameter to simple paths', () => {
      expect(getHrefWithSeason('/dashboard', '100')).toBe(
        '/dashboard?season=100'
      )
      expect(getHrefWithSeason('/analytics', '85')).toBe('/analytics?season=85')
    })

    it('adds season with & when path already has query params', () => {
      expect(getHrefWithSeason('/dashboard?guild=IW', '100')).toBe(
        '/dashboard?guild=IW&season=100'
      )
      expect(getHrefWithSeason('/player?name=John', '85')).toBe(
        '/player?name=John&season=85'
      )
    })

    it('handles paths with multiple existing query params', () => {
      const href = '/analytics?guild=IW&view=detailed'
      expect(getHrefWithSeason(href, '100')).toBe(
        '/analytics?guild=IW&view=detailed&season=100'
      )
    })

    it('handles nested paths', () => {
      expect(getHrefWithSeason('/dashboard/boss/performance', '99')).toBe(
        '/dashboard/boss/performance?season=99'
      )
    })

    it('works with numeric season values', () => {
      expect(getHrefWithSeason('/dashboard', '1')).toBe('/dashboard?season=1')
      expect(getHrefWithSeason('/dashboard', '999')).toBe(
        '/dashboard?season=999'
      )
    })

    it('handles paths with trailing slashes', () => {
      expect(getHrefWithSeason('/dashboard/', '100')).toBe(
        '/dashboard/?season=100'
      )
    })

    it('handles paths with fragments before season', () => {
      const href = '/page?existing=true'
      expect(getHrefWithSeason(href, '50')).toBe(
        '/page?existing=true&season=50'
      )
    })
  })
})
