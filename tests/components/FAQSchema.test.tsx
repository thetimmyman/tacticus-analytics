import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FAQSchema } from '@/app/components/SEO/FAQSchema'
import { TACTICUS_API } from '@tacticus/app-core/app-config'

describe('FAQSchema', () => {
  it('renders FAQ schema JSON-LD with Tacticus API origin', () => {
    const { container } = render(<FAQSchema />)
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).toBeInTheDocument()

    const content = script?.textContent || script?.innerHTML || ''
    const data = JSON.parse(content) as {
      ['@type']: string
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>
    }

    expect(data['@type']).toBe('FAQPage')
    expect(data.mainEntity).toHaveLength(10)

    const apiKeysEntry = data.mainEntity.find(
      (entry) => entry.name === 'What are API Keys and why do I need one?'
    )

    expect(apiKeysEntry?.acceptedAnswer.text).toContain(
      `${TACTICUS_API.ORIGIN}/`
    )
  })
})
