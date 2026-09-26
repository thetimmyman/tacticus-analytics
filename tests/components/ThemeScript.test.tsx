import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ThemeScript } from '@/app/components/ThemeScript'

describe('ThemeScript', () => {
  it('renders inline theme script with nonce and expected markers', () => {
    const { container } = render(<ThemeScript nonce="test-nonce" />)
    const script = container.querySelector('script')
    expect(script).toBeInTheDocument()
    expect(script).toHaveAttribute('nonce', 'test-nonce')

    const content = script?.textContent || ''
    expect(content).toContain('theme-override')
    expect(content).toContain('data-theme')
    expect(content).toContain('theme-loading')
    expect(content).toContain('HORUS_HERESY')
  })
})
