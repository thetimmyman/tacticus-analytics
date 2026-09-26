import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WarSubnavWrapper } from '@/app/(dashboard)/wars/_components/WarSubnavWrapper'
import type { WarSubnavMode } from '@/app/components/navigation/config'

const mockSegment = vi.fn()

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => mockSegment(),
  usePathname: () => '/wars',
  useSearchParams: () => ({ get: () => null })
}))

const capturedProps: { mode: WarSubnavMode }[] = []

vi.mock('@/app/components/navigation/WarSubnav', () => ({
  WarSubnav: (props: { mode: WarSubnavMode }) => {
    capturedProps.push(props)
    return (
      <div data-testid="war-subnav" data-mode={JSON.stringify(props.mode)} />
    )
  }
}))

describe('WarSubnavWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedProps.length = 0
  })

  describe('global mode derivation', () => {
    it.each([null, 'maps', 'metrics', 'lineups', 'cores', 'analyze', 'config'])(
      'lets AlphaChromeBar own global war navigation for segment %s',
      (segment) => {
        mockSegment.mockReturnValue(segment)
        render(<WarSubnavWrapper />)
        expect(capturedProps).toHaveLength(0)
        expect(screen.queryByTestId('war-subnav')).not.toBeInTheDocument()
      }
    )
  })

  describe('detail mode derivation', () => {
    it('passes detail mode for UUID-style warId segment', () => {
      mockSegment.mockReturnValue('abc-123')
      render(<WarSubnavWrapper />)
      expect(capturedProps[0].mode).toEqual({
        kind: 'detail',
        warId: 'abc-123'
      })
    })

    it('passes detail mode for long UUID warId segment', () => {
      mockSegment.mockReturnValue('550e8400-e29b-41d4-a716-446655440000')
      render(<WarSubnavWrapper />)
      expect(capturedProps[0].mode).toEqual({
        kind: 'detail',
        warId: '550e8400-e29b-41d4-a716-446655440000'
      })
    })
  })
})
