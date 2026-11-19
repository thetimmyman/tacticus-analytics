import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ContentCreators,
  LINK_BUTTON_CLASS,
  type LinkType
} from '@/app/components/homepage/ContentCreators'
import { getContrastRatio } from '@/app/lib/utils/contrast'
import { palette } from '../helpers/tailwind-palette'

const TYPES = Object.keys(LINK_BUTTON_CLASS) as LinkType[]
const tokensOf = (cls: string) => cls.split(/\s+/u).filter(Boolean)
const classesOf = (type: LinkType) => tokensOf(LINK_BUTTON_CLASS[type])

// Every palette colour a style paints with: gradient stops or a solid fill.
const STOP = /^(hover:)?(from|via|to|bg)-(white|black|[a-z]+-\d+)$/u

function stops(tokens: string[], state: 'rest' | 'hover') {
  const found = new Map<string, string>()
  for (const wanted of state === 'rest' ? [false] : [false, true]) {
    for (const token of tokens) {
      const match = STOP.exec(token)
      if (match && Boolean(match[1]) === wanted) found.set(match[2]!, match[3]!)
    }
  }
  return [...found.values()]
}

const COLOUR_TEXT = /^(?:[a-z-]+:)*text-(?!(?:xs|sm|base|lg|\d?xl)$)/u
const colourTokens = (tokens: string[]) =>
  tokens.filter((t) => COLOUR_TEXT.test(t))

const renderedLinks = () => {
  const { container } = render(<ContentCreators />)
  return [...container.querySelectorAll('a[target="_blank"]')]
}

describe('resource link buttons: a label chosen for its own fill', () => {
  it('renders every link type, each with a style from the table', () => {
    const classes = renderedLinks().map((a) => a.getAttribute('class') ?? '')
    for (const cls of classes) {
      expect(
        TYPES.some((type) => cls.includes(LINK_BUTTON_CLASS[type])),
        cls
      ).toBe(true)
    }
    for (const type of TYPES) {
      expect(
        classes.some((cls) => cls.includes(LINK_BUTTON_CLASS[type])),
        type
      ).toBe(true)
    }
  })

  it('only the website style takes theme colours; the rest paint with palette colours', () => {
    // The contrast check below can only compute palette colours, so a style
    // built on theme tokens would be skipped silently: it must fail here.
    expect(
      TYPES.filter((t) => stops(classesOf(t), 'rest').length === 0)
    ).toEqual(['website'])
  })

  it('no palette style mixes in a theme or arbitrary colour', () => {
    for (const type of TYPES.filter((t) => t !== 'website')) {
      expect(
        classesOf(type).filter((t) =>
          /^(?:hover:)?(?:from|via|to|bg|text)-[([]/u.test(t)
        ),
        type
      ).toEqual([])
    }
  })

  it.each(TYPES.filter((t) => t !== 'website'))(
    '%s: its single label colour reads on every fill colour, at rest and on hover',
    (type) => {
      const tokens = classesOf(type)
      const labels = colourTokens(tokens)
      expect(labels, `${type} needs exactly one label colour`).toHaveLength(1)
      const label = /^text-(white|black)$/u.exec(labels[0]!)?.[1]
      expect(label, `${type} label must be white or black`).toBeTruthy()
      for (const state of ['rest', 'hover'] as const) {
        const fills = stops(tokens, state)
        expect(fills.length, `${type} ${state} fills`).toBeGreaterThanOrEqual(1)
        for (const fill of fills) {
          expect(
            getContrastRatio(palette(label!), palette(fill)),
            `${type} ${state} ${label} on ${fill}`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  )

  it('the website style pairs each fill with its own on-token', () => {
    expect(colourTokens(classesOf('website')).sort()).toEqual([
      'hover:text-on-accent-wh40k',
      'text-on-primary-wh40k'
    ])
    for (const token of [
      'bg-primary-wh40k',
      'hover:bg-accent-wh40k',
      'border-primary-wh40k',
      'hover:border-accent-wh40k'
    ]) {
      expect(classesOf('website')).toContain(token)
    }
  })

  it('the rendered button has one label colour, no brightening, a focus ring and a still reduced-motion hover', () => {
    const links = renderedLinks()
    expect(links.length).toBeGreaterThan(10)
    for (const link of links) {
      const tokens = tokensOf(link.getAttribute('class') ?? '')
      const own = TYPES.find((t) =>
        classesOf(t).every((token) => tokens.includes(token))
      )
      expect(own, tokens.join(' ')).toBeDefined()
      // The shared base adds only the size; the style adds the label.
      expect(colourTokens(tokens).sort()).toEqual(
        colourTokens(classesOf(own!)).sort()
      )
      const effects = tokens.filter((t) =>
        /^(?:[a-z-]+:)*(?:opacity-|brightness-|saturate-|contrast-|grayscale|invert|sepia|hue-rotate|blur|\[filter)/u.test(
          t
        )
      )
      expect(effects, 'no filter or opacity effect on the button').toEqual([])
      expect(tokens).toContain('hover:filter-none')
      expect(tokens).toContain('hover:-translate-y-0.5')
      expect(tokens).toContain('motion-reduce:hover:translate-none')
      for (const ring of [
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-white',
        'focus-visible:shadow-[0_0_0_6px_black]'
      ]) {
        expect(tokens).toContain(ring)
      }
    }
  })

  it('every link swaps colours in one frame, so a label and fill that change together never cross mid-fade', () => {
    // Website: label on-primary -> on-accent while the fill goes primary ->
    // accent; two 0.3s fades meet at about 1:1 on 33 of 62 themes.
    const links = renderedLinks()
    expect(links.length).toBeGreaterThan(10)
    for (const link of links) {
      expect(tokensOf(link.getAttribute('class') ?? '')).toContain(
        'no-transition'
      )
    }
  })

  it('the film glyph on the red avatar is opaque white and reads on both avatar colours', () => {
    const { container } = render(<ContentCreators />)
    const glyph = container.querySelector('svg.h-7.w-7')
    const tokens = tokensOf(glyph?.getAttribute('class') ?? '')
    expect(tokens).toContain('text-white')
    expect(tokens.filter((t) => /opacity|\/\d/u.test(t))).toEqual([])
    const avatar = tokensOf(glyph?.parentElement?.getAttribute('class') ?? '')
    const fills = stops(avatar, 'rest')
    expect(fills.length).toBeGreaterThanOrEqual(2)
    for (const fill of fills) {
      // A graphic needs 3:1.
      expect(
        getContrastRatio(palette('white'), palette(fill)),
        fill
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
