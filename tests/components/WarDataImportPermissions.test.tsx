import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WarDataImport from '@/app/(dashboard)/wars/_components/WarDataImport'

/** The tab shows for every role, so non-managers need a permission state. */
describe('WarDataImport permission gate', () => {
  it('tells members who can import instead of rendering nothing', () => {
    const { container } = render(
      <WarDataImport guildCode="TESTGUILD" userRole="member" />
    )

    expect(container).not.toBeEmptyDOMElement()
    expect(
      screen.getByText(/only guild/i).textContent?.toLowerCase()
    ).toContain('leaders')
    expect(screen.getByText('member')).toBeInTheDocument()
    expect(screen.queryByText(/Import Data/i)).not.toBeInTheDocument()
  })

  it.each(['leader', 'officer'])('renders the importer for %s', (role) => {
    render(<WarDataImport guildCode="TESTGUILD" userRole={role} />)
    expect(screen.getByText(/Import Data/i)).toBeInTheDocument()
  })
})
