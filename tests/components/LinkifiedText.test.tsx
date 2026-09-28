import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  LinkifiedText,
  parseLinkifiedText
} from '@/app/components/ui/LinkifiedText'

describe('LinkifiedText', () => {
  it('renders plain text without links', () => {
    render(<LinkifiedText text="No links here" />)

    expect(screen.getByText('No links here')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders markdown links with attributes', () => {
    render(
      <LinkifiedText
        text="Visit [Docs](https://example.com) now"
        linkClassName="custom-link"
      />
    )

    const link = screen.getByRole('link', { name: 'Docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveClass('custom-link')
  })

  it('renders unmatched markdown as plain text', () => {
    render(<LinkifiedText text="See [Broken]() link" />)

    expect(screen.getByText('See [Broken]() link')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders unsafe URL schemes as inert text', () => {
    const { container } = render(
      <LinkifiedText text="Do not [click](javascript:alert(1))" />
    )

    expect(screen.queryByRole('link')).toBeNull()
    expect(container).toHaveTextContent('Do not click)')
  })

  it('preserves newlines via whitespace-pre-line so the diagnostic second line is not collapsed', () => {
    const { container } = render(
      <LinkifiedText
        text={'Could not connect.\n\nDATABASE_CONNECTION_FAILED'}
      />
    )
    const span = container.querySelector('span')
    expect(span?.className).toContain('whitespace-pre-line')
    expect(span?.textContent).toContain('Could not connect.')
    expect(span?.textContent).toContain('DATABASE_CONNECTION_FAILED')
  })
})

describe('parseLinkifiedText', () => {
  it('splits text into link parts', () => {
    const parts = parseLinkifiedText('See [Doc](https://example.com) now')

    expect(parts).toEqual([
      { text: 'See ' },
      { text: 'Doc', url: 'https://example.com/' },
      { text: ' now' }
    ])
  })

  it('returns full text when no links are present', () => {
    expect(parseLinkifiedText('Plain text')).toEqual([{ text: 'Plain text' }])
  })

  it('drops unsafe URL schemes from parsed link parts', () => {
    expect(parseLinkifiedText('[click](javascript:alert(1))')).toEqual([
      { text: 'click', url: undefined },
      { text: ')' }
    ])
  })
})
