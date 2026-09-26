import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { AdminDashboard } from '@/app/(dashboard)/admin/feature-releases/AdminDashboard'

vi.mock('@/app/(dashboard)/admin/feature-releases/UserManager', () => ({
  UserManager: () => <div>User manager content</div>
}))
vi.mock('@/app/(dashboard)/admin/feature-releases/CarouselManager', () => ({
  CarouselManager: () => <div>Carousel content</div>
}))
vi.mock('@/app/(dashboard)/admin/feature-releases/ActivityAnalytics', () => ({
  ActivityAnalytics: () => <div>Analytics content</div>
}))
vi.mock(
  '@/app/(dashboard)/admin/feature-releases/GlobalThresholdsManager',
  () => ({ GlobalThresholdsManager: () => <div>Threshold content</div> })
)

describe('AdminDashboard tabs', () => {
  it('keeps releases, circuit breakers, and invite codes out of the top-level tabs', () => {
    render(<AdminDashboard />)

    const labels = within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual([
      'Manage Users',
      'Carousel Manager',
      'Activity Analytics',
      'Strength Thresholds'
    ])
    expect(screen.getByText('User manager content')).toBeInTheDocument()
  })
})
