import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: [], error: null }))
}))

vi.mock('@/app/lib/db/client', () => ({ dbClient: () => supabase }))

import { GuildTeamsClient } from '@/app/(dashboard)/guild-teams/GuildTeamsClient'
import {
  PAGE_TITLES,
  pickPageTitle
} from '@/app/(dashboard)/guild-teams/guild-teams-shared'

const props = {
  guildCode: 'TG',
  heroMappings: {},
  pageTitle: 'Test Guild Raid Teams'
}

describe('GuildTeamsClient hydration', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    )
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hydrates the server heading without a text mismatch when randomness differs', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    container.innerHTML = renderToString(<GuildTeamsClient {...props} />)
    const serverHeading = container.querySelector('h1')?.textContent

    random.mockReturnValue(0.99)
    const onRecoverableError = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, <GuildTeamsClient {...props} />, {
        onRecoverableError
      })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(serverHeading).toBe(props.pageTitle)
    expect(container.querySelector('h1')?.textContent).toBe(props.pageTitle)
  })
})

describe('pickPageTitle', () => {
  it.each([
    [0, 0],
    [0.5, Math.floor(0.5 * PAGE_TITLES.length)],
    [0.9999, PAGE_TITLES.length - 1]
  ])('maps random %s to title index %s', (value, index) => {
    expect(pickPageTitle(() => value)).toBe(PAGE_TITLES[index])
  })

  it('always returns one of the titles', () => {
    for (let i = 0; i < 50; i++) {
      expect(PAGE_TITLES).toContain(pickPageTitle())
    }
  })
})
