import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HeroUnitPortrait } from '@/app/components/ui/HeroUnitPortrait'
import { HeroCatalog } from '@/app/lib/catalogs/heroes'

let catalogData: HeroCatalog | null = null

vi.mock('@/app/lib/catalogs/heroes', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/catalogs/heroes')>()
  return {
    ...actual,
    useHeroCatalog: () => ({ data: catalogData })
  }
})

const makeCatalog = () =>
  new HeroCatalog([
    {
      unitId: 'eldryon',
      displayName: 'Eldryon',
      faction: 'Aeldari',
      traits: [],
      iconUrl: 'https://cdn.example/eldryon.png',
      portraitUrl: 'https://cdn.example/eldryon.png',
      category: 'hero'
    }
  ])

describe('HeroUnitPortrait', () => {
  beforeEach(() => {
    cleanup()
    catalogData = null
  })

  it('renders the portrait image branch when the catalog resolves a hero', () => {
    catalogData = makeCatalog()
    render(<HeroUnitPortrait unitName="eldryon" />)

    const portrait = screen.getByRole('img', { name: 'Eldryon' })
    expect(portrait).toBeInTheDocument()
    expect(portrait.style.backgroundImage).toContain(
      'https://cdn.example/eldryon.png'
    )
    expect(portrait.style.backgroundImage).toContain('linear-gradient(135deg')
    expect(portrait.getAttribute('title')).toBe('Eldryon')
    expect(portrait.className).toContain('h-8 w-8')
    expect(portrait.textContent).toBe('Eldryon')
  })

  it('falls back to a two-letter badge when the catalog is unavailable', () => {
    render(<HeroUnitPortrait unitName="Maugan Ra" />)

    const badge = screen.getByText('MR')
    expect(badge.getAttribute('title')).toBe('Maugan Ra')
    expect(badge.className).toContain('h-8 w-8')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('falls back to a badge for unknown units even with a catalog loaded', () => {
    catalogData = makeCatalog()
    render(<HeroUnitPortrait unitName="Bellator" />)

    expect(screen.getByText('BE').getAttribute('title')).toBe('Bellator')
  })

  it('applies the md size and forwards className on both branches', () => {
    catalogData = makeCatalog()
    const { rerender } = render(
      <HeroUnitPortrait unitName="eldryon" size="md" className="extra-class" />
    )

    const portrait = screen.getByRole('img', { name: 'Eldryon' })
    expect(portrait.className).toContain('h-10 w-10')
    expect(portrait.className).toContain('extra-class')

    rerender(
      <HeroUnitPortrait unitName="Unknown" size="md" className="extra-class" />
    )
    const badge = screen.getByText('UN')
    expect(badge.className).toContain('h-10 w-10')
    expect(badge.className).toContain('extra-class')
  })
})
