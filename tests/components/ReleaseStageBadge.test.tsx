import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import { getStageDisplayInfo } from '@/app/lib/utils/release-stage'

describe('ReleaseStageBadge', () => {
  it('renders label and icon by default', () => {
    const { container } = render(<ReleaseStageBadge stage="beta" />)

    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders nothing for public stage', () => {
    const { container } = render(<ReleaseStageBadge stage="public" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('omits the icon when showIcon is false', () => {
    const { container } = render(
      <ReleaseStageBadge stage="alpha" showIcon={false} />
    )

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('uses size classes for large badges', () => {
    const { container } = render(<ReleaseStageBadge stage="alpha" size="lg" />)

    const badge = container.querySelector('span')
    expect(badge).not.toBeNull()
    expect(badge).toHaveClass('text-xs', 'px-2', 'py-1', 'gap-1')
  })

  it('uses the canonical stage display helper', () => {
    expect(getStageDisplayInfo('beta')).toMatchObject({
      label: 'Beta',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/15',
      borderColor: 'border-blue-500/30'
    })
  })
})
