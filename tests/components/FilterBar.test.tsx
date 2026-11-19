import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from '@/app/components/ui/FilterBar'

describe('FilterBar', () => {
  it('names the secondary control and reports its own active count', () => {
    render(
      <FilterBar
        secondaryLabel="Rarity"
        secondaryFilters={<span>chips</span>}
        activeSecondaryCount={2}
        activeCount={3}
        onReset={() => {}}
      />
    )
    const toggle = screen.getByRole('button', { name: /^rarity/i })
    expect(within(toggle).getByText('(2 active)')).toBeTruthy()
    // One readable name, with a space between the label and the count.
    expect(screen.getByRole('button', { name: 'Rarity (2 active)' })).toBe(
      toggle
    )
  })

  it('does not claim the closed group has active filters when only a primary one is set', () => {
    render(
      <FilterBar
        secondaryFilters={<span>chips</span>}
        activeSecondaryCount={0}
        activeCount={1}
        onReset={() => {}}
      />
    )
    const toggle = screen.getByRole('button', { name: /more filters/i })
    expect(within(toggle).queryByText(/active/)).toBeNull()
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeTruthy()
  })

  it('opens and closes the secondary group with an accurate expanded state', async () => {
    render(<FilterBar secondaryFilters={<span>chips</span>} />)
    const toggle = screen.getByRole('button', { name: /more filters/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('chips')).toBeNull()
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('chips')).toBeTruthy()
  })

  it('renders a page action at the end of the control row', async () => {
    const onClick = vi.fn()
    render(
      <FilterBar
        primaryFilters={<span>cluster</span>}
        actions={<button onClick={onClick}>Refresh</button>}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the secondary group open on wide screens and hides only its toggle there', () => {
    render(
      <FilterBar secondaryOpenOnWide secondaryFilters={<span>chips</span>} />
    )
    const toggle = screen.getByRole('button', { name: /more filters/i })
    expect(toggle.className).toContain('sm:hidden')
    const panel = screen.getByText('chips').parentElement!
    expect(panel.className).toContain('hidden')
    expect(panel.className).toContain('sm:flex')
  })
})
