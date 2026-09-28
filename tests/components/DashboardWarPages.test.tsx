import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import WarLayout from '@/app/(dashboard)/wars/[warId]/layout'
import WarSummaryPage from '@/app/(dashboard)/wars/[warId]/page'
import WarMapsPage from '@/app/(dashboard)/wars/[warId]/maps/page'
import ZonesPage from '@/app/(dashboard)/wars/[warId]/zones/page'
import GuildStatsPage from '@/app/(dashboard)/wars/[warId]/guild/page'
import OpponentStatsPage from '@/app/(dashboard)/wars/[warId]/opponent/page'
import FailedAttemptsPage from '@/app/(dashboard)/wars/[warId]/failed/page'
import PerfectHitsPage from '@/app/(dashboard)/wars/[warId]/perfect/page'
import RecentActivityPage from '@/app/(dashboard)/wars/[warId]/recent/page'

const { redirectSpy } = vi.hoisted(() => ({ redirectSpy: vi.fn() }))
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  redirect: (url: string) => {
    redirectSpy(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  }
}))

const {
  warLayoutClientSpy,
  warSummaryClientSpy,
  guildStatsClientSpy,
  opponentStatsClientSpy,
  failedAttemptsClientSpy,
  perfectHitsClientSpy,
  recentActivityClientSpy
} = vi.hoisted(() => ({
  warLayoutClientSpy: vi.fn(),
  warSummaryClientSpy: vi.fn(),
  guildStatsClientSpy: vi.fn(),
  opponentStatsClientSpy: vi.fn(),
  failedAttemptsClientSpy: vi.fn(),
  perfectHitsClientSpy: vi.fn(),
  recentActivityClientSpy: vi.fn()
}))

vi.mock('@/app/(dashboard)/wars/_components/WarLayoutClient', () => ({
  default: ({
    warId,
    children
  }: {
    warId: string
    children: React.ReactNode
  }) => {
    warLayoutClientSpy({ warId })
    return <div data-testid="war-layout-client">{children}</div>
  }
}))

vi.mock('@/app/(dashboard)/wars/[warId]/WarSummaryClient', () => ({
  default: ({ warId }: { warId: string }) => {
    warSummaryClientSpy({ warId })
    return <div data-testid="war-summary-client" />
  }
}))

vi.mock('@/app/(dashboard)/wars/_components/WarPlayerStatsClient', () => ({
  default: ({ warId, side }: { warId: string; side: 'guild' | 'opponent' }) => {
    if (side === 'guild') {
      guildStatsClientSpy({ warId, side })
      return <div data-testid="guild-stats-client" />
    }
    opponentStatsClientSpy({ warId, side })
    return <div data-testid="opponent-stats-client" />
  }
}))

vi.mock('@/app/(dashboard)/wars/[warId]/failed/FailedAttemptsClient', () => ({
  default: ({ warId }: { warId: string }) => {
    failedAttemptsClientSpy({ warId })
    return <div data-testid="failed-attempts-client" />
  }
}))

vi.mock('@/app/(dashboard)/wars/[warId]/perfect/PerfectHitsClient', () => ({
  default: ({ warId }: { warId: string }) => {
    perfectHitsClientSpy({ warId })
    return <div data-testid="perfect-hits-client" />
  }
}))

vi.mock('@/app/(dashboard)/wars/[warId]/recent/RecentActivityClient', () => ({
  default: ({ warId }: { warId: string }) => {
    recentActivityClientSpy({ warId })
    return <div data-testid="recent-activity-client" />
  }
}))

vi.mock('@tacticus/ui-kit', () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-title">{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  )
}))

describe('Dashboard war pages', () => {
  beforeEach(() => {
    warLayoutClientSpy.mockReset()
    warSummaryClientSpy.mockReset()
    guildStatsClientSpy.mockReset()
    opponentStatsClientSpy.mockReset()
    failedAttemptsClientSpy.mockReset()
    perfectHitsClientSpy.mockReset()
    recentActivityClientSpy.mockReset()
  })

  it('renders war layout with war id', async () => {
    const result = await WarLayout({
      params: Promise.resolve({ warId: 'war-1' }),
      children: <div data-testid="war-child" />
    })
    render(result)

    expect(warLayoutClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-1' })
    )
    expect(screen.getByTestId('war-child')).toBeInTheDocument()
  })

  it('passes war id to summary client', async () => {
    const result = await WarSummaryPage({
      params: Promise.resolve({ warId: 'war-2' })
    })
    render(result)

    expect(warSummaryClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-2' })
    )
  })

  it('redirects the legacy per-war maps page to the board', async () => {
    await expect(
      WarMapsPage({ params: Promise.resolve({ warId: 'war-3' }) })
    ).rejects.toThrow('NEXT_REDIRECT:/wars/war-3/board')
    expect(redirectSpy).toHaveBeenCalledWith('/wars/war-3/board')
  })

  it('redirects the legacy per-war zones page to the board', async () => {
    await expect(
      ZonesPage({ params: Promise.resolve({ warId: 'war-4' }) })
    ).rejects.toThrow('NEXT_REDIRECT:/wars/war-4/board')
    expect(redirectSpy).toHaveBeenCalledWith('/wars/war-4/board')
  })

  it('passes war id to guild stats client', async () => {
    const result = await GuildStatsPage({
      params: Promise.resolve({ warId: 'war-5' })
    })
    render(result)

    expect(guildStatsClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-5', side: 'guild' })
    )
  })

  it('passes war id to opponent stats client', async () => {
    const result = await OpponentStatsPage({
      params: Promise.resolve({ warId: 'war-6' })
    })
    render(result)

    expect(opponentStatsClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-6', side: 'opponent' })
    )
  })

  it('passes war id to failed attempts client', async () => {
    const result = await FailedAttemptsPage({
      params: Promise.resolve({ warId: 'war-7' })
    })
    render(result)

    expect(failedAttemptsClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-7' })
    )
  })

  it('passes war id to perfect hits client', async () => {
    const result = await PerfectHitsPage({
      params: Promise.resolve({ warId: 'war-8' })
    })
    render(result)

    expect(perfectHitsClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-8' })
    )
  })

  it('passes war id to recent activity client', async () => {
    const result = await RecentActivityPage({
      params: Promise.resolve({ warId: 'war-9' })
    })
    render(result)

    expect(recentActivityClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ warId: 'war-9' })
    )
    expect(screen.getByTestId('recent-activity-client')).toBeInTheDocument()
  })
})
