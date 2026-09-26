import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BossAssignmentsReadOnlyBanner } from '@/app/(dashboard)/boss-assignments/_components/BossAssignmentsReadOnlyBanner'

describe('BossAssignmentsReadOnlyBanner', () => {
  it('explains the live assignment queue to members', () => {
    render(<BossAssignmentsReadOnlyBanner canEdit={false} />)

    const banner = screen.getByRole('note', {
      name: 'Read-only assignment access'
    })
    expect(banner).toHaveTextContent('Read-only view.')
    expect(banner).toHaveTextContent(
      "Assignments are managed by your guild's officers and leaders"
    )
  })

  it('does not show the member banner to editors', () => {
    render(<BossAssignmentsReadOnlyBanner canEdit />)

    expect(
      screen.queryByRole('note', { name: 'Read-only assignment access' })
    ).not.toBeInTheDocument()
  })
})
