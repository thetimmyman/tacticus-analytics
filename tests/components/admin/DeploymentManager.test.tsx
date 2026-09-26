import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DeploymentManager } from '@/app/(dashboard)/admin/deployments/DeploymentManager'

const DEPLOYMENT_DATA = {
  current: {
    version: '1.2.3',
    buildNumber: 42,
    lastUpdated: '2026-08-03 12:00'
  },
  services: [
    {
      service: 'nextjs-web',
      running: 'abcd1234',
      versions: [
        {
          tag: 'abcd1234',
          created: '2026-08-03',
          size: '412MB',
          isCurrent: true
        },
        {
          tag: 'deadbeef',
          created: '2026-08-02',
          size: '410MB',
          isCurrent: false
        }
      ]
    }
  ],
  selfHosted: true,
  timestamp: '2026-08-03T12:00:00Z'
}

// The running tag also appears in the header.
const rowFor = (tag: string) =>
  screen
    .getAllByText(tag)
    .map((node) => node.closest('tr'))
    .find((row): row is HTMLTableRowElement => row != null)!

describe('DeploymentManager version table', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(DEPLOYMENT_DATA)
        } as Response)
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the version headers in order', async () => {
    render(<DeploymentManager />)

    await waitFor(() =>
      expect(screen.getAllByRole('columnheader').length).toBe(4)
    )
    expect(
      screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())
    ).toEqual(['Version', 'Created', 'Size', 'Actions'])
  })

  it('renders the first row and keeps the rollback button off the current version', async () => {
    render(<DeploymentManager />)

    await waitFor(() =>
      expect(screen.getAllByText('abcd1234').length).toBeGreaterThan(1)
    )

    const current = rowFor('abcd1234')
    expect(current.textContent).toContain('CURRENT')
    expect(current.textContent).toContain('2026-08-03')
    expect(current.textContent).toContain('412MB')
    expect(current.textContent).not.toContain('Rollback')

    expect(rowFor('deadbeef').querySelector('button')?.textContent).toBe(
      'Rollback'
    )
  })

  it('tints only the current version row', async () => {
    render(<DeploymentManager />)

    await waitFor(() =>
      expect(screen.getAllByText('abcd1234').length).toBeGreaterThan(1)
    )

    expect(rowFor('abcd1234')).toHaveClass('!bg-green-500/5')
    expect(rowFor('deadbeef')).not.toHaveClass('!bg-green-500/5')
  })

  it('keeps the no-images notice instead of rendering an empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...DEPLOYMENT_DATA,
              services: [
                { service: 'nextjs-web', running: 'abcd1234', versions: [] }
              ]
            })
        } as Response)
      )
    )

    render(<DeploymentManager />)

    await waitFor(() =>
      expect(screen.getByText(/No versioned images found/i)).toBeTruthy()
    )
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
  })
})
