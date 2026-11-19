import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PaginationControls } from '@/app/(public)/explore/components/PaginationControls'

function renderPager(currentPage: number, totalPages: number) {
  return render(
    <PaginationControls
      currentPage={currentPage}
      totalPages={totalPages}
      startIndex={(currentPage - 1) * 20}
      endIndex={currentPage * 20}
      totalItems={totalPages * 20}
      itemsPerPage={20}
      onPageChange={() => {}}
    />
  )
}

describe('Explore pager semantics', () => {
  it('puts the page buttons in a navigation landmark with its own name', () => {
    renderPager(3, 10)
    const nav = screen.getByRole('navigation', { name: /guild list pages/i })
    expect(
      within(nav).getByRole('button', { name: /^previous page$/i })
    ).toBeTruthy()
    expect(
      within(nav).getByRole('button', { name: /^next page$/i })
    ).toBeTruthy()
    expect(within(nav).getByRole('button', { name: /^page 3$/i })).toBeTruthy()
  })

  it('marks only the current page with aria-current, not by colour alone', () => {
    renderPager(5, 10)
    const nav = screen.getByRole('navigation', { name: /guild list pages/i })
    const current = within(nav).getAllByRole('button', { current: 'page' })
    expect(current.map((b) => b.textContent)).toEqual(['5'])
    // Every other numbered button is a plain link to another page.
    expect(
      within(nav)
        .getAllByRole('button', { name: /^page \d+$/i })
        .filter((b) => b.getAttribute('aria-current') !== 'page')
        .every((b) => b.getAttribute('aria-current') === null)
    ).toBe(true)
  })

  it('names the first and last page shortcuts like any other page', () => {
    renderPager(6, 12)
    const nav = screen.getByRole('navigation', { name: /guild list pages/i })
    expect(within(nav).getByRole('button', { name: /^page 1$/i })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: /^page 12$/i })).toBeTruthy()
  })

  it('hides the "..." gap markers from assistive technology', () => {
    renderPager(6, 12)
    const gaps = screen.getAllByText('...')
    expect(gaps).toHaveLength(2)
    expect(gaps.every((g) => g.getAttribute('aria-hidden') === 'true')).toBe(
      true
    )
  })

  it('gives the per-page select an accessible name', () => {
    renderPager(1, 3)
    expect(
      screen.getByRole('combobox', { name: /guilds per page/i })
    ).toBeTruthy()
  })
})
