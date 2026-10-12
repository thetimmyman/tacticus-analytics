'use client'

import { useEffect, useRef, useState } from 'react'
import type { SavedSeasonOutlook } from '@/app/lib/season-forecast/saved-outlook-types'
import { MAX_GUILD_MEMBERS } from '@/app/lib/season-forecast/season-outlook-reduce'

type Calculation = {
  projection: Pick<
    SavedSeasonOutlook['projection'],
    | 'projectedForwardSpend'
    | 'projectedWaste'
    | 'secondsRemaining'
    | 'confidence'
    | 'playersAtCapRisk'
  >
  players: SavedSeasonOutlook['players']
  saved: SavedSeasonOutlook['saved']
  model: SavedSeasonOutlook['model']
}

const FAILURE_MESSAGE =
  'Saved outlook could not be calculated. Cached token usage is unchanged.'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved outlook')
  return value as Record<string, unknown>
}

function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid saved outlook metric')
  return value
}

function readCalculation(
  value: unknown,
  guildCode: string,
  season: string,
  asOf: string
): Calculation {
  const body = object(value)
  const projection = object(body.projection)
  const saved = object(body.saved)
  const model = object(body.model)
  if (
    saved.status !== 'ready' ||
    saved.source !== 'saved-season' ||
    saved.season !== season ||
    saved.asOf !== asOf ||
    projection.guildCode !== guildCode ||
    projection.season !== Number(season) ||
    projection.generatedAt !== asOf ||
    typeof saved.configId !== 'string' ||
    !saved.configId ||
    saved.configId.length > 256 ||
    typeof saved.timeZone !== 'string' ||
    saved.timeZone.length > 100
  )
    throw new Error('Saved outlook context mismatch')
  new Intl.DateTimeFormat('en', { timeZone: saved.timeZone })
  const confidence = projection.confidence
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high')
    throw new Error('Invalid saved outlook confidence')
  if (!Array.isArray(body.players) || body.players.length > MAX_GUILD_MEMBERS)
    throw new Error('Invalid saved outlook players')
  const identifiers = new Set<string>()
  const players = body.players.map((value) => {
    const player = object(value)
    if (
      typeof player.playerId !== 'string' ||
      !player.playerId.trim() ||
      player.playerId.length > 256 ||
      identifiers.has(player.playerId.trim()) ||
      typeof player.displayName !== 'string' ||
      player.displayName.length > 1024 ||
      typeof player.atCapRisk !== 'boolean'
    )
      throw new Error('Invalid saved outlook player')
    identifiers.add(player.playerId.trim())
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      tokensUsed: nonnegative(player.tokensUsed),
      tokensRemaining: nonnegative(player.tokensRemaining),
      projectedWaste: nonnegative(player.projectedWaste),
      atCapRisk: player.atCapRisk
    }
  })
  const playersAtCapRisk = nonnegative(projection.playersAtCapRisk)
  if (
    !Number.isInteger(playersAtCapRisk) ||
    playersAtCapRisk > MAX_GUILD_MEMBERS
  )
    throw new Error('Invalid saved outlook guild risk')
  return {
    projection: {
      projectedForwardSpend: nonnegative(projection.projectedForwardSpend),
      projectedWaste: nonnegative(projection.projectedWaste),
      secondsRemaining: nonnegative(projection.secondsRemaining),
      playersAtCapRisk,
      confidence
    },
    players,
    saved: {
      status: 'ready',
      source: 'saved-season',
      season,
      configId: saved.configId,
      asOf,
      timeZone: saved.timeZone
    },
    model: { appliedDamage: nonnegative(model.appliedDamage) }
  }
}

interface SavedSeasonOutlookCardProps {
  guildCode: string
  season: string
  contextKey: string
}

export function SavedSeasonOutlookCard(props: SavedSeasonOutlookCardProps) {
  return (
    <SavedSeasonOutlookForm
      key={JSON.stringify([props.contextKey, props.guildCode, props.season])}
      guildCode={props.guildCode}
      season={props.season}
    />
  )
}

function SavedSeasonOutlookForm({
  guildCode,
  season
}: Omit<SavedSeasonOutlookCardProps, 'contextKey'>) {
  const [input, setInput] = useState('')
  const [calculation, setCalculation] = useState<Calculation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  function changeTime(value: string) {
    activeRequest.current?.abort()
    setInput(value)
    setCalculation(null)
    setError(null)
    setLoading(false)
  }

  async function calculate() {
    const controller = new AbortController()
    activeRequest.current?.abort()
    activeRequest.current = controller
    setLoading(true)
    setError(null)
    setCalculation(null)
    let failureMessage = FAILURE_MESSAGE
    try {
      const asOf = new Date(`${input}Z`).toISOString()
      const params = new URLSearchParams({ guildCode, season, asOf })
      const response = await fetch(`/api/season-forecast/outlook?${params}`, {
        signal: controller.signal,
        cache: 'no-store'
      })
      if (!response.ok) {
        if (response.status === 422)
          failureMessage =
            'Saved outlook unavailable for this season and as-of time. Use imported history with a captured configuration. Cached token usage is unchanged.'
        await response.arrayBuffer()
        throw new Error('Saved outlook request failed')
      }
      const body: unknown = await response.json()
      if (controller.signal.aborted) return
      setCalculation(readCalculation(body, guildCode, season, asOf))
    } catch {
      if (!controller.signal.aborted) setError(failureMessage)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return (
    <section
      className="card-wh40k p-4 space-y-3"
      aria-label="Saved season outlook"
    >
      <h2 className="text-xl font-semibold">Saved season outlook</h2>
      <p className="text-sm text-secondary-wh40k">Selected season {season}</p>
      <label className="block text-sm text-secondary-wh40k">
        As-of time (UTC)
        <input
          type="datetime-local"
          step="1"
          value={input}
          onChange={(event) => changeTime(event.target.value)}
          className="input-wh40k mt-1 block w-full sm:max-w-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => void calculate()}
        disabled={!input || loading}
        className="btn-wh40k"
      >
        {calculation ? 'Refresh saved outlook' : 'Calculate saved outlook'}
      </button>
      {loading && <p role="status">Calculating saved outlook…</p>}
      {error && <p role="alert">{error}</p>}
      {calculation && (
        <section aria-label="Saved outlook calculation" className="space-y-3">
          <p>
            Saved raid history and captured season configuration. No live API
            request. Uses the current saved roster.
          </p>
          <p>
            Season {calculation.saved.season} · Captured configuration:{' '}
            {calculation.saved.configId}
          </p>
          <p>
            As of {calculation.saved.asOf} · Guild time zone:{' '}
            {calculation.saved.timeZone}
          </p>
          <p>The as-of time is the model instant, not the import time.</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt>Projected forward tokens</dt>
              <dd>{calculation.projection.projectedForwardSpend}</dd>
            </div>
            <div>
              <dt>Applied damage</dt>
              <dd>{calculation.model.appliedDamage}</dd>
            </div>
            <div>
              <dt>Projected waste</dt>
              <dd>{calculation.projection.projectedWaste}</dd>
            </div>
          </dl>
          <p>
            {calculation.projection.confidence} confidence ·{' '}
            {calculation.projection.secondsRemaining} seconds remaining at the
            as-of time
          </p>
          <p>
            Guild model: {calculation.projection.playersAtCapRisk}{' '}
            {calculation.projection.playersAtCapRisk === 1
              ? 'player'
              : 'players'}{' '}
            flagged for cap risk
          </p>
          <p>Player detail is limited to your current access.</p>
          {calculation.players.length === 0 ? (
            <p>No player detail is available for your current access.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="text-left font-semibold">
                  Player token pace
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Used this season</th>
                    <th scope="col">Spendable by season end</th>
                    <th scope="col">Projected waste (tokens)</th>
                    <th scope="col">Projected cap risk</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.players.map((player, index) => (
                    <tr key={player.playerId}>
                      <td>
                        {player.displayName.trim() &&
                        player.displayName.trim() !== player.playerId.trim()
                          ? player.displayName.trim()
                          : `Unnamed member ${index + 1}`}
                      </td>
                      <td>{player.tokensUsed}</td>
                      <td>{player.tokensRemaining}</td>
                      <td>
                        ≈
                        {new Intl.NumberFormat('en', {
                          maximumFractionDigits: 2,
                          useGrouping: false
                        }).format(player.projectedWaste)}
                      </td>
                      <td>{player.atCapRisk ? 'At risk' : 'Not flagged'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Spendable by season end includes modeled regeneration and is limited
            by the season token allowance; it is not the current token bank.
          </p>
          <p>
            A risk flag means the model projects at least one wasted token
            before season end. Rounded display values do not determine the flag.
          </p>
        </section>
      )}
    </section>
  )
}
