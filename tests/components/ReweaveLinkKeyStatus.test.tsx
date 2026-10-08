import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReweaveLink } from '@/app/(dashboard)/profile/ReweaveLink'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

describe('ReweaveLink key status', () => {
  it('shows Configured for a key Tacticus accepts', () => {
    render(<ReweaveLink hasKey keyValid lastVerified={null} />)
    expect(screen.getByText('Configured')).toBeInTheDocument()
  })

  it('tells the owner to replace a key Tacticus rejects', () => {
    render(<ReweaveLink hasKey keyValid={false} lastVerified={null} />)
    expect(screen.queryByText('Configured')).not.toBeInTheDocument()
    expect(
      screen.getByText(/Rejected by Tacticus — reweave a new key/)
    ).toBeInTheDocument()
  })

  it('shows Not Configured without a key', () => {
    render(<ReweaveLink hasKey={false} keyValid={false} lastVerified={null} />)
    expect(screen.getByText('Not Configured')).toBeInTheDocument()
  })
})
