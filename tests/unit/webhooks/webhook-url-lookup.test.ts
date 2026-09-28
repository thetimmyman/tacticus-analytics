import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadWebhookUrlById,
  loadWebhookUrlsByIds
} from '@/app/lib/webhooks/webhook-url-lookup'
import { serviceDb } from '@/app/lib/db'

vi.mock('@/app/lib/db', () => ({ serviceDb: vi.fn() }))

const firstId = '00000000-0000-4000-8000-000000000001'
const secondId = '00000000-0000-4000-8000-000000000002'

describe('webhook URL lookup', () => {
  const inIds = vi.fn()
  const select = vi.fn(() => ({ in: inIds }))
  const from = vi.fn(() => ({ select }))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(serviceDb).mockReturnValue({ from } as never)
  })

  it('deduplicates ids and returns URLs keyed by the selected ids', async () => {
    inIds.mockResolvedValue({
      data: [
        {
          id: firstId,
          webhook_url: 'https://discord.com/api/webhooks/1001/test-token'
        },
        { id: secondId, webhook_url: null }
      ],
      error: null
    })

    const result = await loadWebhookUrlsByIds([firstId, firstId, secondId])

    expect(from).toHaveBeenCalledWith('webhook_config')
    expect(select).toHaveBeenCalledWith('id, webhook_url')
    expect(inIds).toHaveBeenCalledWith('id', [firstId, secondId])
    expect(result.get(firstId)).toBe(
      'https://discord.com/api/webhooks/1001/test-token'
    )
    expect(result.get(secondId)).toBeNull()
  })

  it('does not query for an empty id list', async () => {
    expect(await loadWebhookUrlsByIds([])).toEqual(new Map())
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('throws on a service lookup error', async () => {
    const error = new Error('lookup failed')
    inIds.mockResolvedValue({ data: null, error })

    await expect(loadWebhookUrlById(firstId)).rejects.toBe(error)
  })

  it('returns null when the id is absent', async () => {
    inIds.mockResolvedValue({ data: [], error: null })

    await expect(loadWebhookUrlById(firstId)).resolves.toBeNull()
  })
})
