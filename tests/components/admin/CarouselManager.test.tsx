import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCarouselManager } from '@/app/(dashboard)/admin/feature-releases/useCarouselManager'
import { getCarouselTimeRemaining } from '@/app/(dashboard)/admin/feature-releases/carousel-model'

const ITEM = {
  id: 'item-1',
  title: 'Launch',
  description: null,
  image_url: null,
  link_url: null,
  link_text: 'Learn More',
  item_type: 'news' as const,
  promo_code: null,
  background_color: '#000000',
  text_color: '#ffffff',
  accent_color: '#ff0000',
  is_active: true,
  priority: 2,
  starts_at: null,
  expires_at: null,
  display_duration_seconds: 8,
  created_at: '2026-08-01T00:00:00Z'
}
const SECOND_ITEM = {
  ...ITEM,
  id: 'item-2',
  title: 'Second',
  priority: 1
}

const response = (body: unknown, ok = true) =>
  Promise.resolve({
    ok,
    json: () => Promise.resolve(body)
  } as Response)

describe('useCarouselManager', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === 'GET') {
          return response({ items: [ITEM] })
        }
        return response({ item: ITEM })
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads items and isolates create/save state from the view', async () => {
    const { result } = renderHook(() => useCarouselManager())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual([ITEM])

    act(() => result.current.startCreating())
    expect(result.current.editingItem?.link_text).toBe('Learn More')

    act(() =>
      result.current.setEditingItem((current) => ({
        ...current,
        title: 'New item'
      }))
    )
    await act(async () => result.current.save())

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/carousel',
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.current.editingItem).toBeNull()
    expect(result.current.success).toBe('Item created successfully')
  })

  it('updates active state locally after a successful request', async () => {
    const { result } = renderHook(() => useCarouselManager())
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => result.current.toggleActive(ITEM))

    expect(result.current.items[0]?.is_active).toBe(false)
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/carousel/item-1',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('reports non-OK and malformed load responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
    const failed = renderHook(() => useCarouselManager())
    await waitFor(() => expect(failed.result.current.loading).toBe(false))
    expect(failed.result.current.error).toBe('Failed to load carousel items')
    failed.unmount()

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('invalid json'))
    } as Response)
    const malformed = renderHook(() => useCarouselManager())
    await waitFor(() => expect(malformed.result.current.loading).toBe(false))
    expect(malformed.result.current.error).toBe('Failed to load carousel items')
  })

  it('surfaces API save errors without closing the editor', async () => {
    const { result } = renderHook(() => useCarouselManager())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.startCreating())
    act(() =>
      result.current.setEditingItem((current) => ({
        ...current,
        title: 'Rejected item'
      }))
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      await response({ error: 'Policy rejected the item' }, false)
    )

    await act(async () => result.current.save())

    expect(result.current.error).toBe('Policy rejected the item')
    expect(result.current.editingItem?.title).toBe('Rejected item')
  })

  it('deletes confirmed items locally', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    )
    const { result } = renderHook(() => useCarouselManager())
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => result.current.remove(ITEM.id))

    expect(result.current.items).toEqual([])
    expect(fetch).toHaveBeenCalledWith('/api/admin/carousel/item-1', {
      method: 'DELETE'
    })
  })

  it('re-sorts items after priority updates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      await response({ items: [ITEM, SECOND_ITEM] })
    )
    const { result } = renderHook(() => useCarouselManager())
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => result.current.updatePriority(SECOND_ITEM, 3))

    expect(result.current.items.map((item) => item.id)).toEqual([
      'item-2',
      'item-1'
    ])
  })

  it('reports clipboard rejection without claiming success', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const { result } = renderHook(() => useCarouselManager())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => result.current.copyPromoCode('PROMO'))

    expect(result.current.copiedCode).toBeNull()
    expect(result.current.error).toBe('Failed to copy promo code')
  })
})

describe('getCarouselTimeRemaining', () => {
  it('formats future and expired deadlines deterministically', () => {
    const now = new Date('2026-08-19T12:00:00Z')
    expect(getCarouselTimeRemaining('2026-08-20T14:30:00Z', now)).toBe(
      '1d 2h remaining'
    )
    expect(getCarouselTimeRemaining('2026-08-19T11:59:00Z', now)).toBe(
      'Expired'
    )
  })
})
