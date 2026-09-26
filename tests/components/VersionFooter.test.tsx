import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VersionFooter from '@/app/components/VersionFooter'
import versionData from '@/version.json'

describe('VersionFooter', () => {
  it('renders the version with a literal "v" prefix', () => {
    render(<VersionFooter />)

    // Comparing to version.json would re-assert the component's own source.
    const versionNode = screen.getByText(/^v\d+\.\d+\.\d+$/)
    expect(versionNode).toBeInTheDocument()
    expect(versionNode.textContent?.startsWith('v')).toBe(true)
  })

  it('renders the lastUpdated span', () => {
    render(<VersionFooter />)

    const { lastUpdated } = versionData as { lastUpdated: string }
    expect(screen.getByText(lastUpdated)).toBeInTheDocument()
  })
})
