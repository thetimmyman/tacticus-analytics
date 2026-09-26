import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PageAudienceNotice } from '@/app/components/ui/PageAudienceNotice'
import {
  PLAYER_STATS_AUDIENCE,
  PLAYER_STATS_AUDIENCE_FOOTNOTE
} from '@/app/components/playerstats/player-stats-audience'

describe('PageAudienceNotice', () => {
  it('names every audience entry', () => {
    render(<PageAudienceNotice audience={['Alice', 'Bob']} />)

    const notice = screen.getByTestId('page-audience-notice')
    expect(notice).toHaveTextContent('Restricted page')
    expect(notice).toHaveTextContent('visible to')
    expect(within(notice).getByText('Alice')).toBeInTheDocument()
    expect(within(notice).getByText('Bob')).toBeInTheDocument()
  })

  it('renders nothing rather than an empty promise when the audience is unknown', () => {
    const { container } = render(<PageAudienceNotice audience={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the footnote when a scope needs clarifying', () => {
    render(<PageAudienceNotice audience={['Alice']} footnote="Cluster-wide." />)
    expect(screen.getByTestId('page-audience-notice')).toHaveTextContent(
      'Cluster-wide.'
    )
  })
})

describe('PLAYER_STATS_AUDIENCE', () => {
  it('states the cluster scope, not the guild scope', () => {
    // The gate admits officers from any guild in the viewer's cluster.
    render(
      <PageAudienceNotice
        audience={PLAYER_STATS_AUDIENCE}
        footnote={PLAYER_STATS_AUDIENCE_FOOTNOTE}
      />
    )

    const notice = screen.getByTestId('page-audience-notice')
    expect(notice).toHaveTextContent('The player themselves')
    expect(notice).toHaveTextContent('Officers & leaders in their cluster')
    expect(notice).toHaveTextContent(/Cluster-wide, not guild-only/)
  })
})
