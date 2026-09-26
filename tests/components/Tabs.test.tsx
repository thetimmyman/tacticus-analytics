import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Tabs } from '@tacticus/ui-kit'

const tabs = [
  { id: 'first', label: 'First', content: <p>First panel</p> },
  { id: 'second', label: 'Second', content: <p>Second panel</p> },
  { id: 'third', label: 'Third', content: <p>Third panel</p> }
]

describe('Tabs', () => {
  it('exposes tab semantics and a 44px minimum touch target', () => {
    render(<Tabs tabs={tabs} />)

    expect(screen.getByRole('tablist', { name: 'Tabs' })).toBeTruthy()
    const first = screen.getByRole('tab', { name: 'First' })
    const panel = screen.getByRole('tabpanel')

    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(first.getAttribute('tabindex')).toBe('0')
    expect(first.className).toContain('min-h-11')
    expect(first.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(first.id)
    expect(panel.textContent).toContain('First panel')

    const second = screen.getByRole('tab', { name: 'Second' })
    const secondPanel = document.getElementById(
      second.getAttribute('aria-controls') ?? ''
    )
    expect(secondPanel).toBeTruthy()
    expect(secondPanel?.hasAttribute('hidden')).toBe(true)
    expect(secondPanel?.textContent).toBe('')
  })

  it('supports arrow, Home, and End keyboard navigation with wrapping', () => {
    render(<Tabs tabs={tabs} />)

    const first = screen.getByRole('tab', { name: 'First' })
    fireEvent.keyDown(first, { key: 'ArrowLeft' })

    const third = screen.getByRole('tab', { name: 'Third' })
    expect(document.activeElement).toBe(third)
    expect(third.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toContain('Third panel')

    fireEvent.keyDown(third, { key: 'Home' })
    expect(document.activeElement).toBe(first)
    expect(first.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(first, { key: 'End' })
    expect(document.activeElement).toBe(third)

    fireEvent.keyDown(third, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(first)
  })

  it('reports keyboard selection without mutating a controlled value', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} value="first" onChange={onChange} />)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'First' }), {
      key: 'ArrowRight'
    })

    expect(onChange).toHaveBeenCalledWith('second')
    expect(
      screen.getByRole('tab', { name: 'First' }).getAttribute('aria-selected')
    ).toBe('true')
  })
})
