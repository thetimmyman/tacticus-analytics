import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'

const baseTabs = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
]

describe('PageTabsSubnav', () => {
  it('renders nothing when no tabs are supplied', () => {
    const { container } = render(
      <PageTabsSubnav tabs={[]} value="a" onValueChange={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders one button per tab with active aria-selected on the chosen value', () => {
    render(
      <PageTabsSubnav tabs={baseTabs} value="b" onValueChange={() => {}} />
    )
    const a = screen.getByTestId('page-tab-a')
    const b = screen.getByTestId('page-tab-b')
    const c = screen.getByTestId('page-tab-c')
    expect(a).toHaveAttribute('aria-selected', 'false')
    expect(b).toHaveAttribute('aria-selected', 'true')
    expect(c).toHaveAttribute('aria-selected', 'false')
    expect(b).toHaveAttribute('aria-current', 'page')
  })

  it('fires onValueChange when a non-active tab is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <PageTabsSubnav tabs={baseTabs} value="a" onValueChange={onValueChange} />
    )
    fireEvent.click(screen.getByTestId('page-tab-c'))
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('c')
  })

  it('renders icon and badge when supplied', () => {
    render(
      <PageTabsSubnav
        tabs={[
          {
            value: 'p',
            label: 'Premium',
            icon: <span data-testid="icon-premium">★</span>,
            badge: 'P'
          }
        ]}
        value="p"
        onValueChange={() => {}}
      />
    )
    expect(screen.getByTestId('icon-premium')).toBeInTheDocument()
    const tab = screen.getByTestId('page-tab-p')
    expect(tab).toHaveTextContent(/Premium/)
    expect(tab).toHaveTextContent(/^.*Premium.*P.*$/)
  })

  it('renders an anchor (href) tab as a Link, not a button', () => {
    render(
      <PageTabsSubnav
        tabs={[
          { value: 'home', label: 'Home', href: '/home' },
          { value: 'about', label: 'About' }
        ]}
        value="home"
        onValueChange={() => {}}
      />
    )
    const link = screen.getByTestId('page-tab-home')
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('href', '/home')
    const button = screen.getByTestId('page-tab-about')
    expect(button.tagName.toLowerCase()).toBe('button')
  })

  it('disabled tabs do not fire onValueChange', () => {
    const onValueChange = vi.fn()
    render(
      <PageTabsSubnav
        tabs={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta', disabled: true }
        ]}
        value="a"
        onValueChange={onValueChange}
      />
    )
    const disabled = screen.getByTestId('page-tab-b')
    expect(disabled).toBeDisabled()
    fireEvent.click(disabled)
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('uses the supplied ariaLabel for the tablist', () => {
    render(
      <PageTabsSubnav
        tabs={baseTabs}
        value="a"
        onValueChange={() => {}}
        ariaLabel="War Dashboard sections"
      />
    )
    expect(
      screen.getByRole('tablist', { name: 'War Dashboard sections' })
    ).toBeInTheDocument()
  })
})
