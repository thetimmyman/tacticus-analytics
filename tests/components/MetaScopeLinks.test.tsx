import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContextualMetaScopeLinks,
  MetaScopeLinks
} from '@/app/(dashboard)/meta-atlas/components/MetaScopeLinks'

const mocks = vi.hoisted(() => ({
  clusterCode: null as string | null
}))

vi.mock('@/app/lib/hooks/useDataContext', () => ({
  useDataContext: () => ({
    context: { clusterCode: mocks.clusterCode },
    loading: false
  })
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

beforeEach(() => {
  mocks.clusterCode = null
})

describe('MetaScopeLinks', () => {
  it('renders no dead-end links when no destination is available', () => {
    const { container } = render(<MetaScopeLinks hasCluster={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows Global Meta only to members of a cluster', () => {
    render(<MetaScopeLinks hasCluster={true} />)

    expect(screen.getByRole('link', { name: 'Global Meta' })).toHaveAttribute(
      'href',
      '/leaderboards/meta-analysis'
    )
  })

  it('never links to the deleted tiered meta analysis page', () => {
    const { container } = render(<MetaScopeLinks hasCluster={true} />)

    expect(container.innerHTML).not.toContain('/tiered-meta-analysis')
    expect(
      screen.queryByRole('link', { name: 'Tier Benchmarks' })
    ).not.toBeInTheDocument()
  })

  it('sources cluster gating from the populated data access context', () => {
    const { rerender } = render(<ContextualMetaScopeLinks />)
    expect(
      screen.queryByRole('link', { name: 'Global Meta' })
    ).not.toBeInTheDocument()

    mocks.clusterCode = 'EOT'
    rerender(<ContextualMetaScopeLinks />)

    expect(screen.getByRole('link', { name: 'Global Meta' })).toHaveAttribute(
      'href',
      '/leaderboards/meta-analysis'
    )
  })

  it('labels the surviving destination with its real, global scope', () => {
    const { container } = render(<MetaScopeLinks hasCluster />)

    expect(container).toHaveTextContent(
      'Global Meta (what every guild actually runs)'
    )
    expect(container).not.toHaveTextContent('Cluster Meta')
    expect(container).not.toHaveTextContent('your cluster actually runs')
  })
})
